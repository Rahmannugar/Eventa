import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventMediaUploadRepository } from '../../src/events/repositories/event-media-upload.repository';
import { EventMediaMutationRepository } from '../../src/events/repositories/event-media-mutation.repository';
import { EventMediaObjectDeletionRepository } from '../../src/events/repositories/event-media-object-deletion.repository';
import { EventPublicationOutboxRepository } from '../../src/events/repositories/event-publication-outbox.repository';
import { EventManagementRepository } from '../../src/events/repositories/event-management.repository';
import { eventAdminAuditLog } from '../../src/events/schema/event-admin-audit.schema';
import { eventMediaObjectDeletions } from '../../src/events/schema/event-media-object-deletion.schema';
import { eventMediaUploads } from '../../src/events/schema/event-media-upload.schema';
import { eventMedia } from '../../src/events/schema/event-media.schema';
import { eventPublicationOutbox } from '../../src/events/schema/event-publication-outbox.schema';
import { eventVenues } from '../../src/events/schema/event-venue.schema';
import { events } from '../../src/events/schema/event.schema';
import { EventMediaVerificationService } from '../../src/events/services/event-media-verification.service';
import { EventMediaObjectDeletionService } from '../../src/events/services/event-media-object-deletion.service';
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
const eventsRepository = new EventManagementRepository(database);
const uploadsRepository = new EventMediaUploadRepository(database);
const mediaRepository = new EventMediaMutationRepository(database);
const deletionsRepository = new EventMediaObjectDeletionRepository(database);
const publicationOutboxRepository = new EventPublicationOutboxRepository(
  client,
);

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

describe('Event mutation integration', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(eventPublicationOutbox);
    await database.delete(eventAdminAuditLog);
    await database.delete(eventMediaObjectDeletions);
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

  it('replaces verified media atomically', async () => {
    const original = await createAttachedCover('Replacement event');
    const replacementId = randomUUID();
    const replacementKey = `events/${original.eventId}/uploads/${replacementId}.jpg`;
    const upload = await uploadsRepository.createUpload({
      actorAdminId: original.adminId,
      contentType: 'image/jpeg',
      eventId: original.eventId,
      expectedVersion: 2,
      expiresAt: new Date(Date.now() + 60_000),
      verificationDeadlineAt: new Date(Date.now() + 120_000),
      objectKey: replacementKey,
      requestId: randomUUID(),
      sizeBytes: 4,
      slot: 'cover',
      uploadId: replacementId,
    });
    expect(upload.outcome).toBe('created');

    await expect(verifier.verify(replacementId)).resolves.toEqual({
      kind: 'replaced',
    });

    const [persistedEvent] = await database
      .select({ version: events.version })
      .from(events)
      .where(eq(events.id, original.eventId));
    const [persistedMedia] = await database
      .select({ id: eventMedia.id, objectKey: eventMedia.objectKey })
      .from(eventMedia)
      .where(eq(eventMedia.eventId, original.eventId));
    const [replacementAuditCount] = await database
      .select({ value: count() })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.action, 'event.media_replaced'));
    const [deletion] = await database
      .select({
        objectKey: eventMediaObjectDeletions.objectKey,
        reason: eventMediaObjectDeletions.reason,
        status: eventMediaObjectDeletions.status,
      })
      .from(eventMediaObjectDeletions);

    expect(persistedEvent?.version).toBe(3);
    expect(persistedMedia).toEqual({
      id: replacementId,
      objectKey: replacementKey,
    });
    expect(replacementAuditCount?.value).toBe(1);
    expect(deletion).toEqual({
      objectKey: original.objectKey,
      reason: 'replaced',
      status: 'pending',
    });
  });

  it('keeps verified media when replacement fails', async () => {
    const original = await createAttachedCover('Rejected replacement event');
    const replacementId = randomUUID();
    await uploadsRepository.createUpload({
      actorAdminId: original.adminId,
      contentType: 'image/jpeg',
      eventId: original.eventId,
      expectedVersion: 2,
      expiresAt: new Date(Date.now() + 60_000),
      verificationDeadlineAt: new Date(Date.now() + 120_000),
      objectKey: `events/${original.eventId}/uploads/${replacementId}.jpg`,
      requestId: randomUUID(),
      sizeBytes: 4,
      slot: 'cover',
      uploadId: replacementId,
    });
    const rejectedVerifier = new EventMediaVerificationService(
      uploadsRepository,
      {
        createUploadUrl: (input) =>
          verifiedObjectStorage.createUploadUrl(input),
        delete: () => Promise.resolve(),
        inspect: () =>
          Promise.resolve({
            outcome: 'invalid',
            failureCode: 'MEDIA_CONTENT_INVALID',
          }),
      },
    );

    await expect(rejectedVerifier.verify(replacementId)).resolves.toEqual({
      kind: 'rejected',
    });

    const [persistedEvent] = await database
      .select({ version: events.version })
      .from(events)
      .where(eq(events.id, original.eventId));
    const [persistedMedia] = await database
      .select({ id: eventMedia.id, objectKey: eventMedia.objectKey })
      .from(eventMedia)
      .where(eq(eventMedia.eventId, original.eventId));
    const [replacementAuditCount] = await database
      .select({ value: count() })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.action, 'event.media_replaced'));

    expect(persistedEvent?.version).toBe(2);
    expect(persistedMedia).toEqual({
      id: original.uploadId,
      objectKey: original.objectKey,
    });
    expect(replacementAuditCount?.value).toBe(0);
  });

  it('removes media atomically', async () => {
    const original = await createAttachedCover('Removal event');

    await expect(
      mediaRepository.remove({
        actorAdminId: original.adminId,
        eventId: original.eventId,
        expectedVersion: 2,
        requestId: randomUUID(),
        slot: 'cover',
      }),
    ).resolves.toEqual({ outcome: 'removed', eventVersion: 3 });

    const [persistedEvent] = await database
      .select({ version: events.version })
      .from(events)
      .where(eq(events.id, original.eventId));
    const [mediaCount] = await database
      .select({ value: count() })
      .from(eventMedia)
      .where(eq(eventMedia.eventId, original.eventId));
    const [removalAuditCount] = await database
      .select({ value: count() })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.action, 'event.media_removed'));
    const [deletion] = await database
      .select({
        objectKey: eventMediaObjectDeletions.objectKey,
        reason: eventMediaObjectDeletions.reason,
        status: eventMediaObjectDeletions.status,
      })
      .from(eventMediaObjectDeletions);

    expect(persistedEvent?.version).toBe(3);
    expect(mediaCount?.value).toBe(0);
    expect(removalAuditCount?.value).toBe(1);
    expect(deletion).toEqual({
      objectKey: original.objectKey,
      reason: 'removed',
      status: 'pending',
    });
  });

  it('stops object deletion after ten failures', async () => {
    const original = await createAttachedCover('Deletion failure event');
    await mediaRepository.remove({
      actorAdminId: original.adminId,
      eventId: original.eventId,
      expectedVersion: 2,
      requestId: randomUUID(),
      slot: 'cover',
    });
    const [deletion] = await database
      .select({ deletionId: eventMediaObjectDeletions.id })
      .from(eventMediaObjectDeletions);
    if (deletion === undefined) throw new Error('Deletion record missing');

    let providerCalls = 0;
    const deletionService = new EventMediaObjectDeletionService(
      deletionsRepository,
      {
        createUploadUrl: (input) =>
          verifiedObjectStorage.createUploadUrl(input),
        inspect: (input) => verifiedObjectStorage.inspect(input),
        delete: () => {
          providerCalls += 1;
          return Promise.reject(new Error('R2 unavailable'));
        },
      },
    );

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await database
        .update(eventMediaObjectDeletions)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(eventMediaObjectDeletions.id, deletion.deletionId));
      const outcome = await deletionService.delete(deletion.deletionId);
      expect(outcome.kind).toBe(
        attempt === 10 ? 'object_deletion_failed' : 'retry',
      );
    }

    await expect(deletionService.delete(deletion.deletionId)).resolves.toEqual({
      kind: 'completed',
    });
    const [persisted] = await database
      .select({
        attemptCount: eventMediaObjectDeletions.attemptCount,
        status: eventMediaObjectDeletions.status,
      })
      .from(eventMediaObjectDeletions)
      .where(eq(eventMediaObjectDeletions.id, deletion.deletionId));
    expect(providerCalls).toBe(10);
    expect(persisted).toEqual({ attemptCount: 10, status: 'failed' });
  });

  it('rejects incomplete publication without changing durable state', async () => {
    const event = await eventsRepository.createDraft({
      actorAdminId: randomUUID(),
      requestId: randomUUID(),
      title: 'Incomplete publication',
    });

    await expect(
      eventsRepository.publish({
        actorAdminId: randomUUID(),
        eventId: event.eventId,
        expectedVersion: event.version,
        requestId: randomUUID(),
      }),
    ).resolves.toEqual({ outcome: 'incomplete' });

    const [persistedEvent] = await database
      .select({
        publishedAt: events.publishedAt,
        status: events.status,
        version: events.version,
      })
      .from(events)
      .where(eq(events.id, event.eventId));
    const [publicationAuditCount] = await database
      .select({ value: count() })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.action, 'event.published'));
    const [outboxCount] = await database
      .select({ value: count() })
      .from(eventPublicationOutbox);

    expect(persistedEvent).toEqual({
      publishedAt: null,
      status: 'draft',
      version: 1,
    });
    expect(publicationAuditCount?.value).toBe(0);
    expect(outboxCount?.value).toBe(0);
  });

  it('publishes once with its audit and outbox fact', async () => {
    const event = await createPublishableEvent('Published event');
    const requestId = randomUUID();

    const outcomes = await Promise.all([
      eventsRepository.publish({
        actorAdminId: event.adminId,
        eventId: event.eventId,
        expectedVersion: event.version,
        requestId,
      }),
      eventsRepository.publish({
        actorAdminId: event.adminId,
        eventId: event.eventId,
        expectedVersion: event.version,
        requestId: randomUUID(),
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual([
      'published',
      'version_conflict',
    ]);

    const [persistedEvent] = await database
      .select({
        publishedAt: events.publishedAt,
        status: events.status,
        version: events.version,
      })
      .from(events)
      .where(eq(events.id, event.eventId));
    const audits = await database
      .select({
        actorAdminId: eventAdminAuditLog.actorAdminId,
        eventVersion: eventAdminAuditLog.eventVersion,
        requestId: eventAdminAuditLog.requestId,
      })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.action, 'event.published'));
    const [publication] = await database
      .select({ payload: eventPublicationOutbox.payload })
      .from(eventPublicationOutbox);

    expect(persistedEvent?.status).toBe('published');
    expect(persistedEvent?.version).toBe(event.version + 1);
    expect(persistedEvent?.publishedAt).toBeInstanceOf(Date);
    expect(audits).toEqual([
      {
        actorAdminId: event.adminId,
        eventVersion: event.version + 1,
        requestId,
      },
    ]);
    expect(publication?.payload).toEqual({
      eventId: event.eventId,
      publishedAt: persistedEvent?.publishedAt?.toISOString(),
      type: 'event.published.v1',
      version: event.version + 1,
    });
  });

  it('reclaims publication after a failed relay attempt', async () => {
    const event = await createPublishableEvent('Recovered publication');
    await eventsRepository.publish({
      actorAdminId: event.adminId,
      eventId: event.eventId,
      expectedVersion: event.version,
      requestId: randomUUID(),
    });

    const [firstClaim] = await publicationOutboxRepository.claimBatch(
      1,
      30_000,
    );
    if (firstClaim === undefined) throw new Error('Publication claim missing');
    await expect(
      publicationOutboxRepository.scheduleRetry(
        firstClaim.fact.eventId,
        firstClaim.claimToken,
        'EVENT_BUS_PUBLISH_FAILED',
        new Date(0),
      ),
    ).resolves.toBe(true);

    const [recoveredClaim] = await publicationOutboxRepository.claimBatch(
      1,
      30_000,
    );
    if (recoveredClaim === undefined) {
      throw new Error('Recovered publication claim missing');
    }
    expect(recoveredClaim.attempt).toBe(2);
    expect(recoveredClaim.fact).toEqual(firstClaim.fact);
    await expect(
      publicationOutboxRepository.markPublished(
        recoveredClaim.fact.eventId,
        recoveredClaim.claimToken,
      ),
    ).resolves.toBe(true);

    const [persisted] = await database
      .select({ publishedAt: eventPublicationOutbox.publishedAt })
      .from(eventPublicationOutbox);
    expect(persisted?.publishedAt).toBeInstanceOf(Date);
    await expect(
      publicationOutboxRepository.claimBatch(1, 30_000),
    ).resolves.toEqual([]);
  });

  it('returns published events without disclosing drafts', async () => {
    const draft = await eventsRepository.createDraft({
      actorAdminId: randomUUID(),
      requestId: randomUUID(),
      title: 'Private draft',
    });
    await expect(
      eventsRepository.findPublishedById(draft.eventId),
    ).resolves.toBeUndefined();

    const publishable = await createPublishableEvent('Public event');
    const publication = await eventsRepository.publish({
      actorAdminId: publishable.adminId,
      eventId: publishable.eventId,
      expectedVersion: publishable.version,
      requestId: randomUUID(),
    });
    if (publication.outcome !== 'published') {
      throw new Error('Publication setup failed');
    }

    await expect(
      eventsRepository.findPublishedById(publishable.eventId),
    ).resolves.toMatchObject({
      eventId: publishable.eventId,
      media: [{ slot: 'cover' }],
      status: 'published',
      venue: { city: 'Lagos', countryCode: 'NG' },
      version: publishable.version + 1,
    });
  });
});

async function createAttachedCover(title: string): Promise<{
  adminId: string;
  eventId: string;
  objectKey: string;
  uploadId: string;
}> {
  const adminId = randomUUID();
  const event = await eventsRepository.createDraft({
    actorAdminId: adminId,
    requestId: randomUUID(),
    title,
  });
  const uploadId = randomUUID();
  const objectKey = `events/${event.eventId}/uploads/${uploadId}.jpg`;
  const upload = await uploadsRepository.createUpload({
    actorAdminId: adminId,
    contentType: 'image/jpeg',
    eventId: event.eventId,
    expectedVersion: event.version,
    expiresAt: new Date(Date.now() + 60_000),
    verificationDeadlineAt: new Date(Date.now() + 120_000),
    objectKey,
    requestId: randomUUID(),
    sizeBytes: 4,
    slot: 'cover',
    uploadId,
  });
  if (upload.outcome !== 'created') throw new Error('Upload creation failed');
  const outcome = await verifier.verify(uploadId);
  if (outcome.kind !== 'attached') throw new Error('Media attachment failed');
  return { adminId, eventId: event.eventId, objectKey, uploadId };
}

async function createPublishableEvent(title: string): Promise<{
  adminId: string;
  eventId: string;
  version: number;
}> {
  const event = await createAttachedCover(title);
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const result = await eventsRepository.updateDraft({
    actorAdminId: event.adminId,
    category: 'Community',
    description: 'A complete event ready for publication.',
    endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1_000),
    eventId: event.eventId,
    expectedVersion: 2,
    requestId: randomUUID(),
    startsAt,
    timeZone: 'Africa/Lagos',
    title,
    venue: {
      addressLine1: '1 Marina Road',
      addressLine2: null,
      city: 'Lagos',
      countryCode: 'NG',
      name: 'Eventa Hall',
      postalCode: null,
      region: 'Lagos',
    },
  });
  if (result.outcome !== 'updated') {
    throw new Error('Publishable event setup failed');
  }
  return {
    adminId: event.adminId,
    eventId: event.eventId,
    version: result.event.version,
  };
}
