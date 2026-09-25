import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { TICKET_REVOKED_EVENT_TYPE } from '@eventa/messaging-contracts/ticket/ticket-lifecycle.events';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CancellationEmailRepository } from '../../src/notifications/repositories/cancellation-email.repository';
import { CancellationEmailIngestService } from '../../src/notifications/services/cancellation-email-ingest.service';
import type { TicketRevokedFact } from '../../src/notifications/types/cancellation-email.types';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === '') {
  throw new Error('TEST_DATABASE_URL is required for integration tests');
}
const requiredTestDatabaseUrl = testDatabaseUrl;
const testDatabaseName = new URL(requiredTestDatabaseUrl).pathname.slice(1);
if (!/^[a-z][a-z0-9_]*_test$/.test(testDatabaseName)) {
  throw new Error('TEST_DATABASE_URL must target a database ending in _test');
}

async function ensureTestDatabase(): Promise<void> {
  const adminUrl = new URL(requiredTestDatabaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const [state] = await admin<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_database WHERE datname = ${testDatabaseName}
      ) AS exists
    `;
    if (state?.exists !== true) {
      await admin.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    }
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      Reflect.get(error, 'code') !== '42P04'
    ) {
      throw error;
    }
  } finally {
    await admin.end();
  }
}

const client = postgres(requiredTestDatabaseUrl, {
  max: 10,
  onnotice: () => undefined,
});
const database = drizzle(client);
const ingest = new CancellationEmailIngestService(
  new CancellationEmailRepository(client),
);

interface TableCounts {
  deliveries: number;
  inbox: number;
  outbox: number;
}

interface OutboxRow {
  event_type: string;
  payload: { deliveryId: string; type: string };
  routing_key: string;
}

async function counts(): Promise<TableCounts> {
  const [row] = await client<TableCounts[]>`
    SELECT
      (SELECT count(*)::int FROM cancellation_email_deliveries) AS deliveries,
      (SELECT count(*)::int FROM ticket_revocation_inbox) AS inbox,
      (SELECT count(*)::int FROM notification_job_outbox) AS outbox
  `;
  if (row === undefined) throw new Error('COUNTS_UNAVAILABLE');
  return row;
}

async function outboxRows(): Promise<OutboxRow[]> {
  return client<OutboxRow[]>`
    SELECT event_type, payload, routing_key
    FROM notification_job_outbox
    ORDER BY occurred_at
  `;
}

function revocation(
  overrides: Partial<TicketRevokedFact> = {},
): TicketRevokedFact {
  return {
    attendeeId: randomUUID(),
    eventId: randomUUID(),
    messageId: randomUUID(),
    revokedAt: new Date().toISOString(),
    ticketId: randomUUID(),
    type: TICKET_REVOKED_EVENT_TYPE,
    ...overrides,
  };
}

async function cleanDatabase(): Promise<void> {
  await client`DELETE FROM notification_job_outbox`;
  await client`DELETE FROM cancellation_email_deliveries`;
  await client`DELETE FROM ticket_revocation_inbox`;
}

describe('CancellationEmailIngestService.handleRevocation', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(cleanDatabase);

  afterAll(async () => {
    await client.end();
  });

  it('creates one delivery and one job for the first revocation', async () => {
    const fact = revocation();

    await expect(ingest.handleRevocation(fact)).resolves.toBe('processed');

    expect(await counts()).toEqual({ deliveries: 1, inbox: 1, outbox: 1 });
    const [job] = await outboxRows();
    if (job === undefined) throw new Error('OUTBOX_JOB_MISSING');
    expect(job.event_type).toBe('notification.event-cancellation-email.v1');
    expect(job.routing_key).toBe(
      'eventa.notification.event-cancellation-email.v1',
    );
    expect(job.payload.type).toBe('notification.event-cancellation-email.v1');
    expect(job.payload.deliveryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('groups a second revoked ticket under the same event and attendee', async () => {
    const eventId = randomUUID();
    const attendeeId = randomUUID();
    await ingest.handleRevocation(revocation({ eventId, attendeeId }));
    const second = revocation({ eventId, attendeeId });

    await expect(ingest.handleRevocation(second)).resolves.toBe('grouped');

    expect(await counts()).toEqual({ deliveries: 1, inbox: 2, outbox: 1 });
  });

  it('ignores a replayed revocation message', async () => {
    const fact = revocation();
    await ingest.handleRevocation(fact);

    await expect(ingest.handleRevocation(fact)).resolves.toBe('duplicate');

    expect(await counts()).toEqual({ deliveries: 1, inbox: 1, outbox: 1 });
  });

  it('creates a separate delivery for another attendee on the same event', async () => {
    const eventId = randomUUID();
    await ingest.handleRevocation(revocation({ eventId }));
    await ingest.handleRevocation(revocation({ eventId }));

    expect(await counts()).toEqual({ deliveries: 2, inbox: 2, outbox: 2 });
  });

  it('keeps no inbox row when the grouped delivery cannot be written', async () => {
    const fact = revocation({ attendeeId: 'not-a-uuid' });

    await expect(ingest.handleRevocation(fact)).rejects.toThrow();

    expect(await counts()).toEqual({ deliveries: 0, inbox: 0, outbox: 0 });
  });
});
