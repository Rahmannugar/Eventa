import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { and, count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventMediaUploadRepository } from '../../src/events/repositories/event-media-upload.repository';
import { EventMediaMutationRepository } from '../../src/events/repositories/event-media-mutation.repository';
import { EventMediaObjectDeletionRepository } from '../../src/events/repositories/event-media-object-deletion.repository';
import { EventManagementRepository } from '../../src/events/repositories/event-management.repository';
import { EventCapacityReservationRepository } from '../../src/events/repositories/event-capacity-reservation.repository';
import { EventTicketTypeRepository } from '../../src/events/repositories/event-ticket-type.repository';
import { EventTicketAvailabilityRepository } from '../../src/events/repositories/event-ticket-availability.repository';
import { EventWaitlistRepository } from '../../src/events/repositories/event-waitlist.repository';
import {
  EventPageTokenInvalidError,
  EventScheduleInvalidError,
  EventVenueInvalidError,
  EventVersionConflictError,
  EventCapacityReservationConflictError,
  EventCapacityBusyError,
  EventCapacityUnavailableError,
  EventWaitlistConflictError,
} from '../../src/events/errors/event.errors';
import { eventAdminAuditLog } from '../../src/events/schema/event-admin-audit.schema';
import { eventCategories } from '../../src/events/schema/event-category.schema';
import { eventCapacityReservations } from '../../src/events/schema/event-capacity-reservation.schema';
import { eventJobOutbox } from '../../src/events/schema/event-job-outbox.schema';
import { eventMediaObjectDeletions } from '../../src/events/schema/event-media-object-deletion.schema';
import { eventMediaUploads } from '../../src/events/schema/event-media-upload.schema';
import { eventMedia } from '../../src/events/schema/event-media.schema';
import { eventPublicationOutbox } from '../../src/events/schema/event-publication-outbox.schema';
import { eventTicketCurrencies } from '../../src/events/schema/event-ticket-currency.schema';
import { eventTicketTypes } from '../../src/events/schema/event-ticket-type.schema';
import { eventWaitlistEntries } from '../../src/events/schema/event-waitlist-entry.schema';
import { eventWaitlistOutbox } from '../../src/events/schema/event-waitlist-outbox.schema';
import { eventVenues } from '../../src/events/schema/event-venue.schema';
import { events } from '../../src/events/schema/event.schema';
import { EventMediaVerificationService } from '../../src/events/services/event-media-verification.service';
import { EventMediaObjectDeletionService } from '../../src/events/services/event-media-object-deletion.service';
import { EventManagementService } from '../../src/events/services/event-management.service';
import { EventCapacityReservationService } from '../../src/events/services/event-capacity-reservation.service';
import { EventTicketTypeService } from '../../src/events/services/event-ticket-type.service';
import { EventTicketAvailabilityService } from '../../src/events/services/event-ticket-availability.service';
import { EventWaitlistService } from '../../src/events/services/event-waitlist.service';
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
const ticketTypesRepository = new EventTicketTypeRepository(database);
const ticketTypes = new EventTicketTypeService(ticketTypesRepository);
const ticketAvailability = new EventTicketAvailabilityService(
  new EventTicketAvailabilityRepository(database),
);
const capacityReservationsRepository = new EventCapacityReservationRepository(
  database,
);
const capacityReservations = new EventCapacityReservationService(
  capacityReservationsRepository,
);
const waitlistRepository = new EventWaitlistRepository(database);
const waitlist = new EventWaitlistService(waitlistRepository);

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
    await database.delete(eventWaitlistOutbox);
    await database.delete(eventAdminAuditLog);
    await database.delete(eventWaitlistEntries);
    await database.delete(eventCapacityReservations);
    await database.delete(eventTicketTypes);
    await database.delete(eventTicketCurrencies);
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

  it('groups ticket types under multiple event currencies', async () => {
    const event = await createEventRecord('Ticketed event');
    const salesStartAt = new Date(Date.now() + 60 * 60 * 1_000);
    const salesEndAt = new Date(event.startsAt!.getTime() - 60 * 60 * 1_000);

    const ngn = await ticketTypes.defineCurrency({
      actorAdminId: randomUUID(),
      currency: 'NGN',
      eventId: event.eventId,
      expectedVersion: event.version,
      requestId: randomUUID(),
    });
    const usd = await ticketTypes.defineCurrency({
      actorAdminId: randomUUID(),
      currency: 'USD',
      eventId: event.eventId,
      expectedVersion: ngn.eventVersion,
      requestId: randomUUID(),
    });
    const generalNgn = await ticketTypes.create({
      actorAdminId: randomUUID(),
      capacity: 500,
      eventId: event.eventId,
      expectedVersion: usd.eventVersion,
      name: '  General   admission  ',
      priceMinor: 2_500_000,
      requestId: randomUUID(),
      salesEndAt: salesEndAt.toISOString(),
      salesStartAt: salesStartAt.toISOString(),
      ticketCurrencyId: ngn.ticketCurrency.ticketCurrencyId,
    });
    const generalUsd = await ticketTypes.create({
      actorAdminId: randomUUID(),
      capacity: 500,
      eventId: event.eventId,
      expectedVersion: generalNgn.eventVersion,
      name: 'General admission',
      priceMinor: 20_000,
      requestId: randomUUID(),
      salesEndAt: salesEndAt.toISOString(),
      salesStartAt: salesStartAt.toISOString(),
      ticketCurrencyId: usd.ticketCurrency.ticketCurrencyId,
    });
    const listed = await ticketTypes.list(event.eventId);

    expect(generalNgn).toMatchObject({
      eventVersion: 4,
      ticketType: {
        capacity: 500,
        name: 'General admission',
        priceMinor: 2_500_000,
      },
    });
    expect(listed).toMatchObject({
      eventVersion: 5,
      ticketCurrencies: [{ currency: 'NGN' }, { currency: 'USD' }],
      ticketTypes: [
        { ticketTypeId: generalNgn.ticketType.ticketTypeId },
        { ticketTypeId: generalUsd.ticketType.ticketTypeId },
      ],
    });
  });

  it('rejects a ticket currency owned by another event', async () => {
    const event = await createEventRecord('Currency integrity');
    const otherEvent = await createEventRecord('Other currency owner');
    const currency = await ticketTypes.defineCurrency({
      actorAdminId: randomUUID(),
      currency: 'NGN',
      eventId: otherEvent.eventId,
      expectedVersion: otherEvent.version,
      requestId: randomUUID(),
    });

    await expect(
      ticketTypes.create({
        actorAdminId: randomUUID(),
        capacity: 100,
        eventId: event.eventId,
        expectedVersion: event.version,
        name: 'General admission',
        priceMinor: 2_500_000,
        requestId: randomUUID(),
        salesEndAt: new Date(
          event.startsAt!.getTime() - 60 * 60 * 1_000,
        ).toISOString(),
        salesStartAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
        ticketCurrencyId: currency.ticketCurrency.ticketCurrencyId,
      }),
    ).rejects.toMatchObject({ message: 'EVENT_TICKET_CURRENCY_NOT_FOUND' });
    expect((await ticketTypes.list(event.eventId)).ticketTypes).toHaveLength(0);
  });

  it('serializes ticket type creation against the event version', async () => {
    const event = await createEventRecord('Concurrent ticket setup');
    const currency = await ticketTypes.defineCurrency({
      actorAdminId: randomUUID(),
      currency: 'NGN',
      eventId: event.eventId,
      expectedVersion: event.version,
      requestId: randomUUID(),
    });
    const command = {
      actorAdminId: randomUUID(),
      capacity: 100,
      eventId: event.eventId,
      expectedVersion: currency.eventVersion,
      priceMinor: 0,
      salesEndAt: new Date(
        event.startsAt!.getTime() - 60 * 60 * 1_000,
      ).toISOString(),
      salesStartAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      ticketCurrencyId: currency.ticketCurrency.ticketCurrencyId,
    };

    const results = await Promise.allSettled([
      ticketTypes.create({
        ...command,
        name: 'General admission',
        requestId: randomUUID(),
      }),
      ticketTypes.create({
        ...command,
        name: 'VIP',
        requestId: randomUUID(),
      }),
    ]);
    const listed = await ticketTypes.list(event.eventId);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = results.find(({ status }) => status === 'rejected');
    if (rejected?.status !== 'rejected') {
      throw new Error('Expected one ticket type creation conflict');
    }
    expect(rejected.reason).toBeInstanceOf(EventVersionConflictError);
    expect(listed.ticketTypes).toHaveLength(1);
    expect(listed.eventVersion).toBe(3);
  });

  it('updates and idempotently retires an unused ticket type', async () => {
    const event = await createEventRecord('Editable ticket setup');
    const currency = await ticketTypes.defineCurrency({
      actorAdminId: randomUUID(),
      currency: 'NGN',
      eventId: event.eventId,
      expectedVersion: event.version,
      requestId: randomUUID(),
    });
    const salesStartAt = new Date(Date.now() + 60 * 60 * 1_000);
    const salesEndAt = new Date(event.startsAt!.getTime() - 60 * 60 * 1_000);
    const created = await ticketTypes.create({
      actorAdminId: randomUUID(),
      capacity: 100,
      eventId: event.eventId,
      expectedVersion: currency.eventVersion,
      name: 'General admission',
      priceMinor: 2_500_000,
      requestId: randomUUID(),
      salesEndAt: salesEndAt.toISOString(),
      salesStartAt: salesStartAt.toISOString(),
      ticketCurrencyId: currency.ticketCurrency.ticketCurrencyId,
    });
    const updated = await ticketTypes.update({
      actorAdminId: randomUUID(),
      capacity: 120,
      description: 'Updated details',
      eventId: event.eventId,
      expectedVersion: created.eventVersion,
      name: 'Standard',
      priceMinor: 3_000_000,
      requestId: randomUUID(),
      salesEndAt: salesEndAt.toISOString(),
      salesStartAt: salesStartAt.toISOString(),
      ticketTypeId: created.ticketType.ticketTypeId,
    });
    const retiredVersion = await ticketTypes.retire({
      actorAdminId: randomUUID(),
      eventId: event.eventId,
      expectedVersion: updated.eventVersion,
      requestId: randomUUID(),
      ticketTypeId: created.ticketType.ticketTypeId,
    });
    const repeatedVersion = await ticketTypes.retire({
      actorAdminId: randomUUID(),
      eventId: event.eventId,
      expectedVersion: updated.eventVersion,
      requestId: randomUUID(),
      ticketTypeId: created.ticketType.ticketTypeId,
    });

    expect(updated).toMatchObject({
      eventVersion: 4,
      ticketType: { capacity: 120, name: 'Standard', priceMinor: 3_000_000 },
    });
    expect(retiredVersion).toBe(5);
    expect(repeatedVersion).toBe(5);
    expect((await ticketTypes.list(event.eventId)).ticketTypes).toHaveLength(0);
    const auditRows = await database
      .select({ action: eventAdminAuditLog.action })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.eventId, event.eventId));
    expect(auditRows).toHaveLength(5);
    expect(auditRows.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'event.created',
        'event.ticket_currency_defined',
        'event.ticket_type_created',
        'event.ticket_type_updated',
        'event.ticket_type_retired',
      ]),
    );
  });

  it('protects committed inventory during ticket type changes', async () => {
    const event = await createEventRecord('Committed ticket setup');
    const currency = await ticketTypes.defineCurrency({
      actorAdminId: randomUUID(),
      currency: 'NGN',
      eventId: event.eventId,
      expectedVersion: event.version,
      requestId: randomUUID(),
    });
    const salesStartAt = new Date(Date.now() + 60 * 60 * 1_000);
    const salesEndAt = new Date(event.startsAt!.getTime() - 60 * 60 * 1_000);
    const created = await ticketTypes.create({
      actorAdminId: randomUUID(),
      capacity: 100,
      eventId: event.eventId,
      expectedVersion: currency.eventVersion,
      name: 'General admission',
      priceMinor: 2_500_000,
      requestId: randomUUID(),
      salesEndAt: salesEndAt.toISOString(),
      salesStartAt: salesStartAt.toISOString(),
      ticketCurrencyId: currency.ticketCurrency.ticketCurrencyId,
    });
    await database
      .update(eventTicketTypes)
      .set({ reservedQuantity: 2, soldQuantity: 3 })
      .where(eq(eventTicketTypes.id, created.ticketType.ticketTypeId));
    const base = {
      actorAdminId: randomUUID(),
      capacity: 100,
      eventId: event.eventId,
      expectedVersion: created.eventVersion,
      name: 'General admission',
      priceMinor: 2_500_000,
      requestId: randomUUID(),
      salesEndAt: salesEndAt.toISOString(),
      salesStartAt: salesStartAt.toISOString(),
      ticketTypeId: created.ticketType.ticketTypeId,
    };

    await expect(
      ticketTypes.update({ ...base, capacity: 4 }),
    ).rejects.toMatchObject({
      message: 'EVENT_TICKET_TYPE_CAPACITY_BELOW_COMMITTED',
    });
    await expect(
      ticketTypes.update({ ...base, priceMinor: 3_000_000 }),
    ).rejects.toMatchObject({
      message: 'EVENT_TICKET_TYPE_COMMERCIAL_TERMS_LOCKED',
    });
    await expect(
      ticketTypes.retire({
        actorAdminId: randomUUID(),
        eventId: event.eventId,
        expectedVersion: created.eventVersion,
        requestId: randomUUID(),
        ticketTypeId: created.ticketType.ticketTypeId,
      }),
    ).rejects.toMatchObject({
      message: 'EVENT_TICKET_TYPE_HAS_COMMITTED_INVENTORY',
    });
    await expect(
      ticketTypes.update({ ...base, capacity: 5, name: 'Standard' }),
    ).resolves.toMatchObject({
      eventVersion: 4,
      ticketType: {
        capacity: 5,
        name: 'Standard',
        reservedQuantity: 2,
        soldQuantity: 3,
      },
    });
  });

  it('prevents concurrent reservations from overselling capacity', async () => {
    const ticket = await createPublishedTicketType(5);
    const firstReservationId = randomUUID();
    const secondReservationId = randomUUID();
    const command = {
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 4,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    };

    const results = await Promise.allSettled([
      capacityReservations.reserve({
        ...command,
        reservationId: firstReservationId,
      }),
      capacityReservations.reserve({
        ...command,
        reservationId: secondReservationId,
      }),
    ]);
    const fulfilled = results.find(({ status }) => status === 'fulfilled');
    const rejected = results.find(({ status }) => status === 'rejected');
    if (fulfilled?.status !== 'fulfilled' || rejected?.status !== 'rejected') {
      throw new Error('Expected one reservation and one capacity rejection');
    }
    expect(rejected.reason).toBeInstanceOf(EventCapacityUnavailableError);

    const repeated = await capacityReservations.reserve({
      ...command,
      reservationId: fulfilled.value.reservationId,
    });
    const [persistedType] = await database
      .select({ reservedQuantity: eventTicketTypes.reservedQuantity })
      .from(eventTicketTypes)
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    expect(repeated).toEqual(fulfilled.value);
    expect(persistedType?.reservedQuantity).toBe(4);
    await expect(
      capacityReservations.reserve({
        ...command,
        quantity: 3,
        reservationId: fulfilled.value.reservationId,
      }),
    ).rejects.toMatchObject({
      message: 'EVENT_CAPACITY_RESERVATION_IDEMPOTENCY_CONFLICT',
    });
  });

  it('bounds a reservation by the remaining sales window', async () => {
    const ticket = await createPublishedTicketType(5);
    const salesEndAt = new Date(Date.now() + 2 * 60 * 1_000);
    await database
      .update(eventTicketTypes)
      .set({ salesEndAt })
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));

    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });

    expect(reservation.expiresAt.getTime()).toBe(salesEndAt.getTime());
  });

  it('bounds waiting behind a locked ticket type', async () => {
    const ticket = await createPublishedTicketType(5);
    const lockHeld = createDeferred();
    const releaseLock = createDeferred();
    const blocker = client.begin(async (transaction) => {
      await transaction`
        SELECT id
        FROM event_ticket_types
        WHERE id = ${ticket.ticketTypeId}
        FOR UPDATE
      `;
      lockHeld.resolve();
      await releaseLock.promise;
    });
    await lockHeld.promise;

    try {
      await expect(
        capacityReservations.reserve({
          attendeeId: randomUUID(),
          eventId: ticket.eventId,
          quantity: 1,
          requestId: randomUUID(),
          reservationId: randomUUID(),
          ticketTypeId: ticket.ticketTypeId,
        }),
      ).rejects.toBeInstanceOf(EventCapacityBusyError);
    } finally {
      releaseLock.resolve();
      await blocker;
    }
  });

  it('finalizes and releases each reservation exactly once', async () => {
    const ticket = await createPublishedTicketType(10);
    const finalized = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 3,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    const finalizeCommand = {
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: finalized.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    };
    await capacityReservations.finalize(finalizeCommand);
    await capacityReservations.finalize(finalizeCommand);

    const released = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 2,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    const releaseCommand = {
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: released.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    };
    await capacityReservations.release(releaseCommand);
    await capacityReservations.release(releaseCommand);

    const [persistedType] = await database
      .select({
        reservedQuantity: eventTicketTypes.reservedQuantity,
        soldQuantity: eventTicketTypes.soldQuantity,
      })
      .from(eventTicketTypes)
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    expect(persistedType).toEqual({ reservedQuantity: 0, soldQuantity: 3 });
  });

  it('expires abandoned capacity before it can be finalized', async () => {
    const ticket = await createPublishedTicketType(5);
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 5,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await database
      .update(eventCapacityReservations)
      .set({
        createdAt: new Date(Date.now() - 20 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 1_000),
      })
      .where(eq(eventCapacityReservations.id, reservation.reservationId));

    await expect(
      capacityReservations.finalize({
        eventId: ticket.eventId,
        requestId: randomUUID(),
        reservationId: reservation.reservationId,
        ticketTypeId: ticket.ticketTypeId,
      }),
    ).resolves.toMatchObject({ status: 'expired' });
    await expect(
      capacityReservationsRepository.expire(reservation.reservationId),
    ).resolves.toBe('unchanged');

    const [persistedType] = await database
      .select({
        reservedQuantity: eventTicketTypes.reservedQuantity,
        soldQuantity: eventTicketTypes.soldQuantity,
      })
      .from(eventTicketTypes)
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    const [persistedReservation] = await database
      .select({ status: eventCapacityReservations.status })
      .from(eventCapacityReservations)
      .where(eq(eventCapacityReservations.id, reservation.reservationId));
    expect(persistedType).toEqual({ reservedQuantity: 0, soldQuantity: 0 });
    expect(persistedReservation?.status).toBe('expired');
  });

  it('expires one reservation once under competing sweep work', async () => {
    const ticket = await createPublishedTicketType(5);
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 5,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await database
      .update(eventCapacityReservations)
      .set({
        createdAt: new Date(Date.now() - 20 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 1_000),
      })
      .where(eq(eventCapacityReservations.id, reservation.reservationId));

    const outcomes = await Promise.all([
      capacityReservationsRepository.expire(reservation.reservationId),
      capacityReservationsRepository.expire(reservation.reservationId),
    ]);

    expect(outcomes.sort()).toEqual(['expired', 'unchanged']);
    const [persistedType] = await database
      .select({ reservedQuantity: eventTicketTypes.reservedQuantity })
      .from(eventTicketTypes)
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    expect(persistedType?.reservedQuantity).toBe(0);
  });

  it('serializes competing finalization and release', async () => {
    const ticket = await createPublishedTicketType(2);
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 2,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    const command = {
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: reservation.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    };

    const results = await Promise.allSettled([
      capacityReservations.finalize(command),
      capacityReservations.release(command),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = results.find(({ status }) => status === 'rejected');
    if (rejected?.status !== 'rejected') {
      throw new Error('Expected one terminal reservation conflict');
    }
    expect(rejected.reason).toBeInstanceOf(
      EventCapacityReservationConflictError,
    );

    const [persistedType] = await database
      .select({
        reservedQuantity: eventTicketTypes.reservedQuantity,
        soldQuantity: eventTicketTypes.soldQuantity,
      })
      .from(eventTicketTypes)
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    expect(persistedType?.reservedQuantity).toBe(0);
    expect([0, 2]).toContain(persistedType?.soldQuantity);
  });

  it('admits one durable waitlist entry only when capacity is unavailable', async () => {
    const ticket = await createPublishedTicketType(2);
    const attendeeId = randomUUID();
    const command = {
      attendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    };

    await expect(waitlist.join(command)).rejects.toMatchObject({
      message: 'EVENT_TICKET_CAPACITY_AVAILABLE',
    });
    await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 2,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });

    const [first, repeated] = await Promise.all([
      waitlist.join(command),
      waitlist.join(command),
    ]);
    expect(repeated).toEqual(first);
    expect(first).toMatchObject({ attendeeId, position: 1, status: 'waiting' });
    const [entryCount] = await database
      .select({ value: count() })
      .from(eventWaitlistEntries);
    expect(entryCount?.value).toBe(1);
    await expect(
      waitlist.join({ ...command, quantity: 2 }),
    ).rejects.toBeInstanceOf(EventWaitlistConflictError);
  });

  it('rejects waitlist demand larger than total capacity', async () => {
    const ticket = await createPublishedTicketType(2);

    await expect(
      waitlist.join({
        attendeeId: randomUUID(),
        eventId: ticket.eventId,
        quantity: 3,
        requestId: randomUUID(),
        ticketTypeId: ticket.ticketTypeId,
      }),
    ).rejects.toMatchObject({
      message: 'EVENT_WAITLIST_QUANTITY_EXCEEDS_CAPACITY',
    });

    const [entryCount] = await database
      .select({ value: count() })
      .from(eventWaitlistEntries);
    expect(entryCount?.value).toBe(0);
  });

  it('preserves capacity required by active waitlist demand', async () => {
    const ticket = await createPublishedTicketType(5);
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 5,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await waitlist.join({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 4,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await capacityReservations.release({
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: reservation.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    });
    const [state] = await database
      .select({
        adminId: events.createdByAdminId,
        capacity: eventTicketTypes.capacity,
        name: eventTicketTypes.name,
        priceMinor: eventTicketTypes.priceMinor,
        salesEndAt: eventTicketTypes.salesEndAt,
        salesStartAt: eventTicketTypes.salesStartAt,
        version: events.version,
      })
      .from(eventTicketTypes)
      .innerJoin(
        eventTicketCurrencies,
        eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
      )
      .innerJoin(events, eq(events.id, eventTicketCurrencies.eventId))
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    if (state === undefined) throw new Error('Ticket state setup failed');

    await expect(
      ticketTypes.update({
        actorAdminId: state.adminId,
        capacity: 3,
        eventId: ticket.eventId,
        expectedVersion: state.version,
        name: state.name,
        priceMinor: state.priceMinor,
        requestId: randomUUID(),
        salesEndAt: state.salesEndAt.toISOString(),
        salesStartAt: state.salesStartAt.toISOString(),
        ticketTypeId: ticket.ticketTypeId,
      }),
    ).rejects.toMatchObject({
      message: 'EVENT_TICKET_TYPE_CAPACITY_BELOW_WAITLIST_DEMAND',
    });

    const [persisted] = await database
      .select({ capacity: eventTicketTypes.capacity })
      .from(eventTicketTypes)
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    expect(persisted?.capacity).toBe(state.capacity);
  });

  it('protects capacity for every waitlisted attendee promoted in FIFO order', async () => {
    const ticket = await createPublishedTicketType(2);
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 2,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    const firstAttendeeId = randomUUID();
    const secondAttendeeId = randomUUID();
    await waitlist.join({
      attendeeId: firstAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await waitlist.join({
      attendeeId: secondAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });

    await capacityReservations.release({
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: reservation.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    });
    await expect(
      waitlistRepository.findPromotionCandidates(null, 100),
    ).resolves.toContain(ticket.ticketTypeId);
    await expect(
      waitlistRepository.promote(ticket.ticketTypeId, 100),
    ).resolves.toBe(2);
    const [firstEntry, secondEntry] = await Promise.all([
      waitlist.get({
        attendeeId: firstAttendeeId,
        eventId: ticket.eventId,
        ticketTypeId: ticket.ticketTypeId,
      }),
      waitlist.get({
        attendeeId: secondAttendeeId,
        eventId: ticket.eventId,
        ticketTypeId: ticket.ticketTypeId,
      }),
    ]);
    expect(firstEntry).toMatchObject({ position: null, status: 'eligible' });
    expect(secondEntry).toMatchObject({ position: null, status: 'eligible' });
    expect(firstEntry.opportunityExpiresAt).not.toBeNull();
    expect(secondEntry.opportunityExpiresAt).not.toBeNull();
    expect(firstEntry.opportunityExpiresAt?.getTime()).toBeLessThanOrEqual(
      Date.now() + 15 * 60 * 1_000,
    );
    const [eligibilityFactCount] = await database
      .select({ value: count() })
      .from(eventWaitlistOutbox);
    expect(eligibilityFactCount?.value).toBe(2);

    await expect(
      capacityReservations.reserve({
        attendeeId: randomUUID(),
        eventId: ticket.eventId,
        quantity: 1,
        requestId: randomUUID(),
        reservationId: randomUUID(),
        ticketTypeId: ticket.ticketTypeId,
      }),
    ).rejects.toMatchObject({ message: 'EVENT_WAITLIST_PRIORITY_REQUIRED' });
    await capacityReservations.reserve({
      attendeeId: firstAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await capacityReservations.reserve({
      attendeeId: secondAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    const [type] = await database
      .select({
        reservedQuantity: eventTicketTypes.reservedQuantity,
        soldQuantity: eventTicketTypes.soldQuantity,
      })
      .from(eventTicketTypes)
      .where(eq(eventTicketTypes.id, ticket.ticketTypeId));
    expect(type).toEqual({ reservedQuantity: 2, soldQuantity: 0 });
  });

  it('masks returned capacity while an attendee is waiting', async () => {
    const ticket = await createPublishedTicketType(2);
    const waitingAttendeeId = randomUUID();
    const outsiderId = randomUUID();
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 2,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await waitlist.join({
      attendeeId: waitingAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await capacityReservations.release({
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: reservation.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    });

    const [waitingCatalogue, outsiderCatalogue] = await Promise.all([
      ticketAvailability.getCatalogue(ticket.eventId, waitingAttendeeId),
      ticketAvailability.getCatalogue(ticket.eventId, outsiderId),
    ]);

    expect(waitingCatalogue.ticketTypes[0]).toMatchObject({
      availabilityStatus: 'waiting',
      availableQuantity: 0,
      waitlistPosition: 1,
    });
    expect(outsiderCatalogue.ticketTypes[0]).toMatchObject({
      availabilityStatus: 'unavailable',
      availableQuantity: 0,
      canJoinWaitlist: true,
    });
  });

  it('shows only an eligible offer and genuine public surplus', async () => {
    const ticket = await createPublishedTicketType(2);
    const eligibleAttendeeId = randomUUID();
    const outsiderId = randomUUID();
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 2,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await waitlist.join({
      attendeeId: eligibleAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await capacityReservations.release({
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: reservation.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    });
    await waitlistRepository.promote(ticket.ticketTypeId, 100);

    const [eligibleCatalogue, outsiderCatalogue] = await Promise.all([
      ticketAvailability.getCatalogue(ticket.eventId, eligibleAttendeeId),
      ticketAvailability.getCatalogue(ticket.eventId, outsiderId),
    ]);

    expect(eligibleCatalogue.ticketTypes[0]).toMatchObject({
      availabilityStatus: 'eligible',
      availableQuantity: 1,
      waitlistPosition: null,
    });
    expect(
      eligibleCatalogue.ticketTypes[0]?.opportunityExpiresAt,
    ).toBeInstanceOf(Date);
    expect(outsiderCatalogue.ticketTypes[0]).toMatchObject({
      availabilityStatus: 'available',
      availableQuantity: 1,
      canJoinWaitlist: false,
    });
  });

  it('ignores expired opportunities when calculating waitlist position', async () => {
    const ticket = await createPublishedTicketType(2);
    const firstAttendeeId = randomUUID();
    const secondAttendeeId = randomUUID();
    const reservation = await capacityReservations.reserve({
      attendeeId: randomUUID(),
      eventId: ticket.eventId,
      quantity: 2,
      requestId: randomUUID(),
      reservationId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await waitlist.join({
      attendeeId: firstAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await waitlist.join({
      attendeeId: secondAttendeeId,
      eventId: ticket.eventId,
      quantity: 1,
      requestId: randomUUID(),
      ticketTypeId: ticket.ticketTypeId,
    });
    await capacityReservations.release({
      eventId: ticket.eventId,
      requestId: randomUUID(),
      reservationId: reservation.reservationId,
      ticketTypeId: ticket.ticketTypeId,
    });
    await expect(
      waitlistRepository.promote(ticket.ticketTypeId, 1),
    ).resolves.toBe(1);
    await database
      .update(eventWaitlistEntries)
      .set({
        eligibleAt: new Date(Date.now() - 2 * 60 * 1_000),
        opportunityExpiresAt: new Date(Date.now() - 60 * 1_000),
      })
      .where(
        and(
          eq(eventWaitlistEntries.ticketTypeId, ticket.ticketTypeId),
          eq(eventWaitlistEntries.attendeeId, firstAttendeeId),
        ),
      );

    await expect(
      waitlist.get({
        attendeeId: secondAttendeeId,
        eventId: ticket.eventId,
        ticketTypeId: ticket.ticketTypeId,
      }),
    ).resolves.toMatchObject({ position: 1, status: 'waiting' });
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

  it('rejects publication without a ticket type', async () => {
    const event = await createPublishableEvent('Ticketless event', false);

    await expect(
      eventsRepository.publish({
        actorAdminId: event.adminId,
        eventId: event.eventId,
        expectedVersion: event.version,
        requestId: randomUUID(),
      }),
    ).resolves.toEqual({ outcome: 'incomplete' });
  });

  it('keeps one active ticket type on a published event', async () => {
    const event = await createPublishableEvent('Published inventory floor');
    const publication = await eventsRepository.publish({
      actorAdminId: event.adminId,
      eventId: event.eventId,
      expectedVersion: event.version,
      requestId: randomUUID(),
    });
    if (publication.outcome !== 'published') {
      throw new Error('Expected publication to succeed');
    }
    const [ticketType] = (await ticketTypes.list(event.eventId)).ticketTypes;
    if (ticketType === undefined) throw new Error('Ticket type missing');

    await expect(
      ticketTypes.retire({
        actorAdminId: event.adminId,
        eventId: event.eventId,
        expectedVersion: publication.event.version,
        requestId: randomUUID(),
        ticketTypeId: ticketType.ticketTypeId,
      }),
    ).rejects.toMatchObject({
      message: 'EVENT_TICKET_TYPE_LAST_PUBLISHED_TYPE',
    });
    expect((await ticketTypes.list(event.eventId)).ticketTypes).toHaveLength(1);
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

  it('retires a draft once across repeated delivery', async () => {
    const event = await createEventRecord('Retired draft');
    const firstRequestId = randomUUID();
    const repeatedRequestId = randomUUID();

    const outcomes = await Promise.all([
      eventsRepository.retire({
        actorAdminId: event.createdByAdminId,
        eventId: event.eventId,
        expectedVersion: event.version,
        requestId: firstRequestId,
      }),
      eventsRepository.retire({
        actorAdminId: event.createdByAdminId,
        eventId: event.eventId,
        expectedVersion: event.version,
        requestId: repeatedRequestId,
      }),
    ]);

    const [persisted] = await database
      .select({ retiredAt: events.retiredAt, version: events.version })
      .from(events)
      .where(eq(events.id, event.eventId));
    const audits = await database
      .select({
        actorAdminId: eventAdminAuditLog.actorAdminId,
        eventVersion: eventAdminAuditLog.eventVersion,
        requestId: eventAdminAuditLog.requestId,
      })
      .from(eventAdminAuditLog)
      .where(eq(eventAdminAuditLog.action, 'event.retired'));

    expect(outcomes).toEqual([
      { outcome: 'retired', eventVersion: 2 },
      { outcome: 'retired', eventVersion: 2 },
    ]);
    expect(persisted?.retiredAt).toBeInstanceOf(Date);
    expect(persisted?.version).toBe(2);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorAdminId: event.createdByAdminId,
      eventVersion: 2,
    });
    expect([firstRequestId, repeatedRequestId]).toContain(audits[0]?.requestId);
  });

  it('excludes retired drafts from management reads', async () => {
    const event = await createEventRecord('Hidden retired draft');
    await eventsRepository.retire({
      actorAdminId: event.createdByAdminId,
      eventId: event.eventId,
      expectedVersion: event.version,
      requestId: randomUUID(),
    });

    await expect(
      eventsRepository.findById(event.eventId),
    ).resolves.toBeUndefined();
    await expect(
      eventsRepository.list({
        countryCode: null,
        limit: 20,
        regionCode: null,
        search: null,
        sort: 'updated_desc',
      }),
    ).resolves.toEqual([]);
  });

  it('rejects stale and published retirement commands', async () => {
    const draft = await createEventRecord('Changed draft');
    const updated = await eventsRepository.updateDraft({
      actorAdminId: draft.createdByAdminId,
      categories: draft.categories,
      description: draft.description!,
      endsAt: draft.endsAt!,
      eventId: draft.eventId,
      expectedVersion: draft.version,
      requestId: randomUUID(),
      startsAt: draft.startsAt!,
      timeZone: draft.timeZone!,
      title: draft.title,
      venue: draft.venue!,
    });
    if (updated.outcome !== 'updated') throw new Error('Update setup failed');
    const published = await createPublishableEvent('Published retirement');
    await eventsRepository.publish({
      actorAdminId: published.adminId,
      eventId: published.eventId,
      expectedVersion: published.version,
      requestId: randomUUID(),
    });

    await expect(
      eventsRepository.retire({
        actorAdminId: draft.createdByAdminId,
        eventId: draft.eventId,
        expectedVersion: draft.version,
        requestId: randomUUID(),
      }),
    ).resolves.toEqual({ outcome: 'version_conflict' });
    await expect(
      eventsRepository.retire({
        actorAdminId: published.adminId,
        eventId: published.eventId,
        expectedVersion: published.version + 1,
        requestId: randomUUID(),
      }),
    ).resolves.toEqual({ outcome: 'not_draft' });
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

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function createPublishedTicketType(capacity: number): Promise<{
  eventId: string;
  ticketTypeId: string;
}> {
  const publishable = await createPublishableEvent(
    `Capacity event ${randomUUID()}`,
  );
  const catalogue = await ticketTypes.list(publishable.eventId);
  const ticketType = catalogue.ticketTypes[0];
  if (ticketType === undefined) throw new Error('Ticket setup failed');
  await database
    .update(eventTicketTypes)
    .set({
      capacity,
      salesStartAt: new Date(Date.now() - 60 * 60 * 1_000),
    })
    .where(eq(eventTicketTypes.id, ticketType.ticketTypeId));
  const published = await eventsRepository.publish({
    actorAdminId: publishable.adminId,
    eventId: publishable.eventId,
    expectedVersion: publishable.version,
    requestId: randomUUID(),
  });
  if (published.outcome !== 'published') {
    throw new Error('Event publication setup failed');
  }
  return {
    eventId: publishable.eventId,
    ticketTypeId: ticketType.ticketTypeId,
  };
}

async function createPublishableEvent(
  title: string,
  withTicketType = true,
): Promise<{
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
  if (!withTicketType) {
    return {
      adminId: event.adminId,
      eventId: event.eventId,
      version: result.event.version,
    };
  }
  const currency = await ticketTypes.defineCurrency({
    actorAdminId: event.adminId,
    currency: 'NGN',
    eventId: event.eventId,
    expectedVersion: result.event.version,
    requestId: randomUUID(),
  });
  const ticketType = await ticketTypes.create({
    actorAdminId: event.adminId,
    capacity: 100,
    eventId: event.eventId,
    expectedVersion: currency.eventVersion,
    name: 'General admission',
    priceMinor: 0,
    requestId: randomUUID(),
    salesEndAt: new Date(startsAt.getTime() - 60 * 60 * 1_000).toISOString(),
    salesStartAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    ticketCurrencyId: currency.ticketCurrency.ticketCurrencyId,
  });
  return {
    adminId: event.adminId,
    eventId: event.eventId,
    version: ticketType.eventVersion,
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
