import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CancellationEmailRepository } from '../../src/notifications/repositories/cancellation-email.repository';
import type { CancellationEmailClaim } from '../../src/notifications/types/cancellation-email.types';

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
const repository = new CancellationEmailRepository(client);

interface DeliveryRow {
  attempt_count: number;
  failure_code: string | null;
  status: string;
}

async function createDelivery(): Promise<string> {
  const [row] = await client<{ id: string }[]>`
    INSERT INTO cancellation_email_deliveries (event_id, attendee_id)
    VALUES (${randomUUID()}, ${randomUUID()})
    RETURNING id
  `;
  if (row === undefined) throw new Error('DELIVERY_NOT_CREATED');
  return row.id;
}

async function readDelivery(deliveryId: string): Promise<DeliveryRow> {
  const [row] = await client<DeliveryRow[]>`
    SELECT attempt_count, failure_code, status
    FROM cancellation_email_deliveries
    WHERE id = ${deliveryId}
  `;
  if (row === undefined) throw new Error('DELIVERY_NOT_FOUND');
  return row;
}

async function setAttemptCount(
  deliveryId: string,
  attemptCount: number,
): Promise<void> {
  await client`
    UPDATE cancellation_email_deliveries
    SET attempt_count = ${attemptCount}
    WHERE id = ${deliveryId}
  `;
}

function claimed(result: CancellationEmailClaim) {
  if (result.kind !== 'claimed') {
    throw new Error(`EXPECTED_CLAIMED_BUT_GOT_${result.kind.toUpperCase()}`);
  }
  return result;
}

async function cleanDatabase(): Promise<void> {
  await client`DELETE FROM notification_job_outbox`;
  await client`DELETE FROM cancellation_email_deliveries`;
  await client`DELETE FROM ticket_revocation_inbox`;
}

describe('CancellationEmailRepository delivery claim lifecycle', () => {
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

  it('claims a pending delivery for its first attempt', async () => {
    const deliveryId = await createDelivery();

    const claim = claimed(await repository.claim(deliveryId));

    expect(claim.attempt).toBe(1);
    expect(claim.claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      attempt_count: 1,
      failure_code: null,
      status: 'processing',
    });
  });

  it('reports a busy delivery while an earlier attempt holds the lease', async () => {
    const deliveryId = await createDelivery();
    await repository.claim(deliveryId);

    const second = await repository.claim(deliveryId);

    expect(second.kind).toBe('busy');
    if (second.kind === 'busy') {
      expect(second.retryAt.getTime()).toBeGreaterThan(Date.now());
    }
    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      attempt_count: 1,
      status: 'processing',
    });
  });

  it('completes only the delivery that still holds the matching claim token', async () => {
    const deliveryId = await createDelivery();
    const claim = claimed(await repository.claim(deliveryId));

    await expect(
      repository.markDelivered(deliveryId, randomUUID(), 'provider-message-2'),
    ).resolves.toBe(false);
    await expect(
      repository.markDelivered(
        deliveryId,
        claim.claimToken,
        'provider-message-1',
      ),
    ).resolves.toBe(true);
    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      attempt_count: 1,
      status: 'delivered',
    });
  });

  it('does not schedule a retry for a claim token that no longer matches', async () => {
    const deliveryId = await createDelivery();
    await repository.claim(deliveryId);

    await expect(
      repository.markRetryScheduled(
        deliveryId,
        randomUUID(),
        'EMAIL_PROVIDER_RATE_LIMITED',
        new Date(Date.now() + 60_000),
      ),
    ).resolves.toBe(false);
    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      attempt_count: 1,
      status: 'processing',
    });
  });

  it('holds a scheduled retry until its time has passed', async () => {
    const deliveryId = await createDelivery();
    const claim = claimed(await repository.claim(deliveryId));
    await repository.markRetryScheduled(
      deliveryId,
      claim.claimToken,
      'EMAIL_PROVIDER_RATE_LIMITED',
      new Date(Date.now() + 60_000),
    );

    const early = await repository.claim(deliveryId);

    expect(early.kind).toBe('busy');
    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      attempt_count: 1,
      status: 'retry_scheduled',
    });
  });

  it('claims again once a scheduled retry time has passed', async () => {
    const deliveryId = await createDelivery();
    const claim = claimed(await repository.claim(deliveryId));
    await repository.markRetryScheduled(
      deliveryId,
      claim.claimToken,
      'EMAIL_PROVIDER_RATE_LIMITED',
      new Date(Date.now() - 1_000),
    );

    const second = claimed(await repository.claim(deliveryId));

    expect(second.attempt).toBe(2);
    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      attempt_count: 2,
      status: 'processing',
    });
  });

  it('rejects a delivery that has not reached a terminal state', async () => {
    const deliveryId = await createDelivery();

    await repository.recordRejected(deliveryId, 'JOB_FIELDS_INVALID');

    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      failure_code: 'JOB_FIELDS_INVALID',
      status: 'rejected',
    });
    const rejected = await repository.claim(deliveryId);
    expect(rejected).toEqual({ kind: 'terminal', status: 'rejected' });
  });

  it('fails a delivery whose attempts are already exhausted', async () => {
    const deliveryId = await createDelivery();
    await setAttemptCount(deliveryId, 3);

    expect(await repository.claim(deliveryId)).toEqual({
      kind: 'terminal',
      status: 'failed',
    });
    await expect(readDelivery(deliveryId)).resolves.toMatchObject({
      failure_code: 'ATTEMPTS_EXHAUSTED',
      status: 'failed',
    });
  });
});
