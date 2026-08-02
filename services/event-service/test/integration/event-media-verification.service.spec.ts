import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventMediaUploadRepository } from '../../src/events/repositories/event-media-upload.repository';
import { EventRepository } from '../../src/events/repositories/event.repository';
import { eventAdminAuditLog } from '../../src/events/schema/event-admin-audit.schema';
import { eventMediaUploads } from '../../src/events/schema/event-media-upload.schema';
import { eventMedia } from '../../src/events/schema/event-media.schema';
import { eventVenues } from '../../src/events/schema/event-venue.schema';
import { events } from '../../src/events/schema/event.schema';
import { EventMediaVerificationService } from '../../src/events/services/event-media-verification.service';
import type { EventMediaObjectStorage } from '../../src/events/types/event.types';

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
  const adminClient = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    const [state] = await adminClient<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_database WHERE datname = ${testDatabaseName}
      ) AS exists
    `;
    if (state?.exists !== true) {
      await adminClient.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
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
    await adminClient.end();
  }
}

const client = postgres(requiredTestDatabaseUrl, {
  max: 5,
  onnotice: () => undefined,
});
const database = drizzle(client);
const eventsRepository = new EventRepository(database);
const uploadsRepository = new EventMediaUploadRepository(database);

const verifiedObjectStorage: EventMediaObjectStorage = {
  createUploadUrl: () => Promise.reject(new Error('Not used by verification')),
  delete: () => Promise.resolve(),
  inspect: () =>
    Promise.resolve({
      outcome: 'verified',
      object: {
        contentType: 'image/jpeg',
        etag: 'verified-etag',
        height: 600,
        sizeBytes: 4,
        width: 800,
      },
    }),
};

const verifier = new EventMediaVerificationService(
  uploadsRepository,
  verifiedObjectStorage,
);

describe('EventMediaVerificationService integration', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(eventAdminAuditLog);
    await database.delete(eventMedia);
    await database.delete(eventMediaUploads);
    await database.delete(eventVenues);
    await database.delete(events);
  });

  afterAll(async () => {
    await client.end();
  });

  it('attaches a verified upload once under duplicate delivery', async () => {
    const adminId = randomUUID();
    const event = await eventsRepository.createDraft({
      actorAdminId: adminId,
      requestId: randomUUID(),
      title: 'Media event',
    });
    const uploadId = randomUUID();
    const upload = await uploadsRepository.createUpload({
      actorAdminId: adminId,
      contentType: 'image/jpeg',
      eventId: event.eventId,
      expectedVersion: event.version,
      expiresAt: new Date(Date.now() + 60_000),
      verificationDeadlineAt: new Date(Date.now() + 120_000),
      objectKey: `events/${event.eventId}/uploads/${uploadId}.jpg`,
      requestId: randomUUID(),
      sizeBytes: 4,
      slot: 'cover',
      uploadId,
    });
    expect(upload.outcome).toBe('created');

    const outcomes = await Promise.all([
      verifier.verify(uploadId),
      verifier.verify(uploadId),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      'attached',
      'completed',
    ]);

    const [persistedEvent] = await database
      .select({ version: events.version })
      .from(events)
      .where(eq(events.id, event.eventId));
    const [mediaCount] = await database
      .select({ value: count() })
      .from(eventMedia)
      .where(eq(eventMedia.eventId, event.eventId));
    const [attachmentAuditCount] = await database
      .select({ value: count() })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.action, 'event.media_attached'));
    const [persistedUpload] = await database
      .select({ status: eventMediaUploads.status })
      .from(eventMediaUploads)
      .where(eq(eventMediaUploads.id, uploadId));

    expect(persistedEvent?.version).toBe(2);
    expect(mediaCount?.value).toBe(1);
    expect(attachmentAuditCount?.value).toBe(1);
    expect(persistedUpload?.status).toBe('attached');
  });

  it('accepts a present object after the upload deadline', async () => {
    const adminId = randomUUID();
    const event = await eventsRepository.createDraft({
      actorAdminId: adminId,
      requestId: randomUUID(),
      title: 'Deadline event',
    });
    const uploadId = randomUUID();
    await uploadsRepository.createUpload({
      actorAdminId: adminId,
      contentType: 'image/jpeg',
      eventId: event.eventId,
      expectedVersion: event.version,
      expiresAt: new Date(Date.now() - 1),
      verificationDeadlineAt: new Date(Date.now() + 60_000),
      objectKey: `events/${event.eventId}/uploads/${uploadId}.jpg`,
      requestId: randomUUID(),
      sizeBytes: 4,
      slot: 'cover',
      uploadId,
    });

    await expect(verifier.verify(uploadId)).resolves.toEqual({
      kind: 'attached',
    });

    const [persistedUpload] = await database
      .select({ status: eventMediaUploads.status })
      .from(eventMediaUploads)
      .where(eq(eventMediaUploads.id, uploadId));
    expect(persistedUpload?.status).toBe('attached');
  });
});
