import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EventManagementRepository } from '../../src/events/repositories/event-management.repository';
import { eventAdminAuditLog } from '../../src/events/schema/event-admin-audit.schema';
import { eventCapacityReservations } from '../../src/events/schema/event-capacity-reservation.schema';
import { eventCategories } from '../../src/events/schema/event-category.schema';
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
import { EventManagementService } from '../../src/events/services/event-management.service';

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
    // Two spec files can create the database at the same time: one gets
    // "database already exists", the other the unique-index violation.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    if (code !== '42P04' && code !== '23505') {
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
const eventManagement = new EventManagementService(eventsRepository);

interface SeedOptions {
  status?: 'draft' | 'published' | 'cancelled';
  startsAt?: Date;
  salesStartAt?: Date;
  salesEndAt?: Date;
  capacity?: number;
  soldQuantity?: number;
  tickets?: boolean;
}

async function seedEvent(options: SeedOptions = {}): Promise<string> {
  const eventId = randomUUID();
  const startsAt = options.startsAt ?? new Date(Date.now() + 86_400_000);
  const status = options.status ?? 'published';

  await database.insert(events).values({
    id: eventId,
    title: `Recommendable event ${eventId.slice(0, 8)}`,
    description: 'A complete event.',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 7_200_000),
    timeZone: 'Africa/Lagos',
    status,
    version: 1,
    createdByAdminId: randomUUID(),
    publishedAt: status === 'draft' ? null : new Date(),
    cancelledAt: status === 'cancelled' ? new Date() : null,
  });

  if (options.tickets === false) {
    return eventId;
  }

  const currencyId = randomUUID();
  await database.insert(eventTicketCurrencies).values({
    id: currencyId,
    eventId,
    currency: 'NGN',
  });
  await database.insert(eventTicketTypes).values({
    id: randomUUID(),
    ticketCurrencyId: currencyId,
    name: 'General admission',
    priceMinor: 0,
    capacity: options.capacity ?? 100,
    soldQuantity: options.soldQuantity ?? 0,
    salesStartAt: options.salesStartAt ?? new Date(Date.now() - 3_600_000),
    salesEndAt: options.salesEndAt ?? new Date(startsAt.getTime() - 3_600_000),
  });

  return eventId;
}

describe('Recommendable event resolution', () => {
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

  it('returns a published event that still has a live ticket sale', async () => {
    const eventId = await seedEvent();

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found.map((event) => event.eventId)).toEqual([eventId]);
  });

  it('keeps an event whose tickets open later', async () => {
    const eventId = await seedEvent({
      salesStartAt: new Date(Date.now() + 3_600_000),
    });

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found.map((event) => event.eventId)).toEqual([eventId]);
  });

  it('drops a cancelled event', async () => {
    const eventId = await seedEvent({ status: 'cancelled' });

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found).toEqual([]);
  });

  it('drops a draft event', async () => {
    const eventId = await seedEvent({ status: 'draft' });

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found).toEqual([]);
  });

  it('drops an event whose tickets are sold out', async () => {
    const eventId = await seedEvent({ capacity: 100, soldQuantity: 100 });

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found).toEqual([]);
  });

  it('drops an event whose ticket sales have ended', async () => {
    const eventId = await seedEvent({ salesEndAt: new Date(Date.now() - 60_000) });

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found).toEqual([]);
  });

  it('drops an event that has already started', async () => {
    const startsAt = new Date(Date.now() - 3_600_000);
    const eventId = await seedEvent({
      startsAt,
      salesStartAt: new Date(Date.now() - 86_400_000),
      salesEndAt: new Date(Date.now() + 86_400_000),
    });

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found).toEqual([]);
  });

  it('drops an event without any ticket sale', async () => {
    const eventId = await seedEvent({ tickets: false });

    const found = await eventManagement.listRecommendableByIds([eventId]);

    expect(found).toEqual([]);
  });

  it('drops unknown ids from the batch', async () => {
    const eventId = await seedEvent();

    const found = await eventManagement.listRecommendableByIds([
      randomUUID(),
      eventId,
      randomUUID(),
    ]);

    expect(found.map((event) => event.eventId)).toEqual([eventId]);
  });

  it('answers in the order the ids were requested', async () => {
    const first = await seedEvent();
    const second = await seedEvent();

    const found = await eventManagement.listRecommendableByIds([second, first]);

    expect(found.map((event) => event.eventId)).toEqual([second, first]);
  });

  it('returns an empty batch when no ids are requested', async () => {
    await expect(eventManagement.listRecommendableByIds([])).resolves.toEqual(
      [],
    );
  });
});
