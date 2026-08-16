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
import { EventManagementRepository } from '../../src/events/repositories/event-management.repository';
import {
  EventPageTokenInvalidError,
  EventScheduleInvalidError,
  EventVenueInvalidError,
} from '../../src/events/errors/event.errors';
import { eventAdminAuditLog } from '../../src/events/schema/event-admin-audit.schema';
import { eventCategories } from '../../src/events/schema/event-category.schema';
import { eventJobOutbox } from '../../src/events/schema/event-job-outbox.schema';
import { eventMediaObjectDeletions } from '../../src/events/schema/event-media-object-deletion.schema';
import { eventMediaUploads } from '../../src/events/schema/event-media-upload.schema';
import { eventMedia } from '../../src/events/schema/event-media.schema';
import { eventPublicationOutbox } from '../../src/events/schema/event-publication-outbox.schema';
import { eventVenues } from '../../src/events/schema/event-venue.schema';
import { events } from '../../src/events/schema/event.schema';
import { EventMediaVerificationService } from '../../src/events/services/event-media-verification.service';
import { EventMediaObjectDeletionService } from '../../src/events/services/event-media-object-deletion.service';
import { EventManagementService } from '../../src/events/services/event-management.service';
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
const eventManagement = new EventManagementService(eventsRepository);

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
    await database.delete(eventJobOutbox);
    await database.delete(eventPublicationOutbox);
    await database.delete(eventAdminAuditLog);
    await database.delete(eventMediaObjectDeletions);
    await database.delete(eventMedia);
    await database.delete(eventMediaUploads);
    await database.delete(eventCategories);
    await database.delete(eventVenues);
    await database.delete(events);
  });

  afterAll(async () => {
    await client.end();
  });

  it('creates complete event state atomically', async () => {
    const event = await createEventRecord('Community sports day');
    const persisted = await eventsRepository.findById(event.eventId);

    expect(persisted).toMatchObject({
      categories: ['Community'],
      description: 'A complete event.',
      eventId: event.eventId,
      timeZone: 'Africa/Lagos',
      title: 'Community sports day',
      venue: { city: 'Lagos', countryCode: 'NG', name: 'Eventa Hall' },
    });
    const [auditCount] = await database
      .select({ value: count() })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.eventId, event.eventId));
    expect(auditCount?.value).toBe(1);
  });

  it('rolls back creation when a category invariant fails', async () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    await expect(
      eventsRepository.createDraft({
        actorAdminId: randomUUID(),
        categories: ['Sports', 'sports'],
        description: 'A complete event.',
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1_000),
        requestId: randomUUID(),
        startsAt,
        timeZone: 'Africa/Lagos',
        title: 'Invalid duplicate categories',
        venue: {
          addressLine1: '1 Marina Road',
          addressLine2: null,
          city: 'Lagos',
          countryCode: 'NG',
          name: 'Eventa Hall',
          postalCode: null,
          region: 'Lagos',
          regionCode: 'LA',
        },
      }),
    ).rejects.toBeDefined();

    const [eventCount] = await database.select({ value: count() }).from(events);
    const [venueCount] = await database
      .select({ value: count() })
      .from(eventVenues);
    const [categoryCount] = await database
      .select({ value: count() })
      .from(eventCategories);
    expect([
      eventCount?.value,
      venueCount?.value,
      categoryCount?.value,
    ]).toEqual([0, 0, 0]);
  });

  it('rejects equal start and end times before persistence', async () => {
    const instant = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();

    await expect(
      eventManagement.createDraft({
        actorAdminId: randomUUID(),
        categories: ['Community'],
        description: 'A complete event.',
        endsAt: instant,
        requestId: randomUUID(),
        startsAt: instant,
        timeZone: 'Africa/Lagos',
        title: 'Invalid schedule',
        venue: {
          addressLine1: '1 Marina Road',
          city: 'Lagos',
          countryCode: 'NG',
          name: 'Eventa Hall',
        },
      }),
    ).rejects.toBeInstanceOf(EventScheduleInvalidError);

    const [eventCount] = await database.select({ value: count() }).from(events);
    expect(eventCount?.value).toBe(0);
  });

  it('rejects a region code without a region name', async () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    await expect(
      eventManagement.createDraft({
        actorAdminId: randomUUID(),
        categories: ['Community'],
        description: 'A complete event.',
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1_000).toISOString(),
        requestId: randomUUID(),
        startsAt: startsAt.toISOString(),
        timeZone: 'Europe/Copenhagen',
        title: 'Invalid venue',
        venue: {
          addressLine1: '1 Harbour Road',
          city: 'Copenhagen',
          countryCode: 'DK',
          name: 'Eventa Hall',
          regionCode: 'DK-84',
        },
      }),
    ).rejects.toBeInstanceOf(EventVenueInvalidError);
  });

  it('pages the admin event catalogue without duplicates', async () => {
    await createEventRecord('First event');
    await createEventRecord('Second event');
    await createEventRecord('Third event');

    const firstPage = await eventManagement.list({
      pageSize: 2,
      sort: 'updated_desc',
    });
    if (firstPage.nextPageToken === undefined) {
      throw new Error('Expected another catalogue page');
    }
    const secondPage = await eventManagement.list({
      pageSize: 2,
      pageToken: firstPage.nextPageToken,
      sort: 'updated_desc',
    });
    const eventIds = [...firstPage.events, ...secondPage.events].map(
      ({ eventId }) => eventId,
    );

    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.nextPageToken).toBeDefined();
    expect(secondPage.events).toHaveLength(1);
    expect(secondPage.nextPageToken).toBeUndefined();
    expect(new Set(eventIds).size).toBe(3);
    expect(
      firstPage.events.every(({ categories }) => categories[0] === 'Community'),
    ).toBe(true);
  });

  it('filters the catalogue by name and venue codes', async () => {
    await createEventRecord('Lagos Design Forum');
    await createEventRecord('Lagos Music Night', randomUUID(), {
      region: 'Oyo',
      regionCode: 'OY',
    });
    await createEventRecord('Copenhagen Design Forum', randomUUID(), {
      city: 'Copenhagen',
      countryCode: 'DK',
      region: 'Hovedstaden',
      regionCode: 'DK-84',
    });

    const page = await eventManagement.list({
      countryCode: 'ng',
      pageSize: 20,
      regionCode: 'la',
      search: ' DESIGN ',
      sort: 'updated_desc',
    });

    expect(page.events.map(({ title }) => title)).toEqual([
      'Lagos Design Forum',
    ]);
    await expect(
      eventManagement.list({
        countryCode: 'DK',
        pageSize: 20,
        regionCode: 'DK-84',
        search: 'design',
        sort: 'updated_desc',
      }),
    ).resolves.toMatchObject({
      events: [{ title: 'Copenhagen Design Forum' }],
    });
  });

  it('treats search punctuation literally', async () => {
    await createEventRecord('100% Community Day');
    await createEventRecord('Plain Community Day');

    const page = await eventManagement.list({
      pageSize: 20,
      search: '%',
      sort: 'updated_desc',
    });

    expect(page.events.map(({ title }) => title)).toEqual([
      '100% Community Day',
    ]);
  });

  it('orders event-date pages without duplicates', async () => {
    await createEventRecord('Middle event', randomUUID(), {
      startsAt: new Date('2027-03-02T10:00:00.000Z'),
    });
    await createEventRecord('Last event', randomUUID(), {
      startsAt: new Date('2027-03-03T10:00:00.000Z'),
    });
    await createEventRecord('First event', randomUUID(), {
      startsAt: new Date('2027-03-01T10:00:00.000Z'),
    });

    const firstPage = await eventManagement.list({
      pageSize: 2,
      sort: 'event_date_asc',
    });
    if (firstPage.nextPageToken === undefined) {
      throw new Error('Expected another catalogue page');
    }
    const secondPage = await eventManagement.list({
      pageSize: 2,
      pageToken: firstPage.nextPageToken,
      sort: 'event_date_asc',
    });

    expect(
      [...firstPage.events, ...secondPage.events].map(({ title }) => title),
    ).toEqual(['First event', 'Middle event', 'Last event']);
  });

  it('rejects a cursor reused with different criteria', async () => {
    await createEventRecord('First event');
    await createEventRecord('Second event');
    const firstPage = await eventManagement.list({
      pageSize: 1,
      search: 'event',
      sort: 'updated_desc',
    });
    if (firstPage.nextPageToken === undefined) {
      throw new Error('Expected another catalogue page');
    }

    await expect(
      eventManagement.list({
        pageSize: 1,
        pageToken: firstPage.nextPageToken,
        search: 'second',
        sort: 'updated_desc',
      }),
    ).rejects.toBeInstanceOf(EventPageTokenInvalidError);
  });

  it('attaches a verified upload once under duplicate delivery', async () => {
    const adminId = randomUUID();
    const event = await createEventRecord('Media event', adminId);
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
    const [job] = await database
      .select({
        aggregateType: eventJobOutbox.aggregateType,
        eventType: eventJobOutbox.eventType,
        payload: eventJobOutbox.payload,
        routingKey: eventJobOutbox.routingKey,
      })
      .from(eventJobOutbox);

    expect(persistedEvent?.version).toBe(2);
    expect(mediaCount?.value).toBe(1);
    expect(attachmentAuditCount?.value).toBe(1);
    expect(persistedUpload?.status).toBe('attached');
    expect(job).toEqual({
      aggregateType: 'eventa.event.jobs',
      eventType: 'event.media-verification.v1',
      payload: { type: 'event.media-verification.v1', uploadId },
      routingKey: 'eventa.event.media-verification.v1',
    });
  });

  it('accepts a present object after the upload deadline', async () => {
    const adminId = randomUUID();
    const event = await createEventRecord('Deadline event', adminId);
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
    const event = await createEventRecord('Incomplete publication');

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
    const competingRequestId = randomUUID();

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
        requestId: competingRequestId,
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
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorAdminId: event.adminId,
      eventVersion: event.version + 1,
    });
    expect([requestId, competingRequestId]).toContain(audits[0]?.requestId);
    expect(publication?.payload).toEqual({
      eventId: event.eventId,
      publishedAt: persistedEvent?.publishedAt?.toISOString(),
      type: 'event.published.v1',
      version: event.version + 1,
    });
  });

  it('returns published events without disclosing drafts', async () => {
    const draft = await createEventRecord('Private draft');
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
  const event = await createEventRecord(title, adminId);
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
    categories: ['Community'],
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
      regionCode: 'LA',
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

async function createEventRecord(
  title: string,
  adminId = randomUUID(),
  options: {
    city?: string;
    countryCode?: string;
    region?: string;
    regionCode?: string;
    startsAt?: Date;
  } = {},
) {
  const startsAt =
    options.startsAt ?? new Date(Date.now() + 24 * 60 * 60 * 1_000);
  return eventsRepository.createDraft({
    actorAdminId: adminId,
    categories: ['Community'],
    description: 'A complete event.',
    endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1_000),
    requestId: randomUUID(),
    startsAt,
    timeZone: 'Africa/Lagos',
    title,
    venue: {
      addressLine1: '1 Marina Road',
      addressLine2: null,
      city: options.city ?? 'Lagos',
      countryCode: options.countryCode ?? 'NG',
      name: 'Eventa Hall',
      postalCode: null,
      region: options.region ?? 'Lagos',
      regionCode: options.regionCode ?? 'LA',
    },
  });
}
