import { Inject } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
import { eventCategories } from '../schema/event-category.schema';
import { eventMedia } from '../schema/event-media.schema';
import { eventPublicationOutbox } from '../schema/event-publication-outbox.schema';
import { eventTicketTypes } from '../schema/event-ticket-type.schema';
import { eventTicketCurrencies } from '../schema/event-ticket-currency.schema';
import { eventVenues } from '../schema/event-venue.schema';
import { events } from '../schema/event.schema';
import type {
  CreateDraftEvent,
  AdminEventSummaryRecord,
  EventVenue,
  EventMediaRecord,
  EventRecord,
  ListAdminEvents,
  EventRepository as EventRepositoryPort,
  PublishEvent,
  PublishEventResult,
  RetireDraftEvent,
  RetireDraftEventResult,
  UpdateDraftEvent,
  UpdateDraftEventResult,
} from '../types/event.types';

const EVENT_COLUMNS = {
  eventId: events.id,
  title: events.title,
  description: events.description,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  timeZone: events.timeZone,
  status: events.status,
  version: events.version,
  createdByAdminId: events.createdByAdminId,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
  publishedAt: events.publishedAt,
  retiredAt: events.retiredAt,
};

const VENUE_COLUMNS = {
  name: eventVenues.name,
  addressLine1: eventVenues.addressLine1,
  addressLine2: eventVenues.addressLine2,
  city: eventVenues.city,
  region: eventVenues.region,
  regionCode: eventVenues.regionCode,
  postalCode: eventVenues.postalCode,
  countryCode: eventVenues.countryCode,
};

const MEDIA_COLUMNS = {
  mediaId: eventMedia.id,
  slot: eventMedia.slot,
  objectKey: eventMedia.objectKey,
  contentType: eventMedia.contentType,
  sizeBytes: eventMedia.sizeBytes,
  width: eventMedia.width,
  height: eventMedia.height,
};

export class EventManagementRepository implements EventRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  createDraft(input: CreateDraftEvent): Promise<EventRecord> {
    return runWithOperationSpan(
      'event.create_draft',
      () =>
        this.database.transaction(async (transaction) => {
          const [event] = await transaction
            .insert(events)
            .values({
              createdByAdminId: input.actorAdminId,
              description: input.description,
              endsAt: input.endsAt,
              startsAt: input.startsAt,
              timeZone: input.timeZone,
              title: input.title,
            })
            .returning(EVENT_COLUMNS);

          if (event === undefined) {
            throw new Error('Event insert returned no row');
          }

          const [venue] = await transaction
            .insert(eventVenues)
            .values({ eventId: event.eventId, ...input.venue })
            .returning(VENUE_COLUMNS);

          if (venue === undefined) {
            throw new Error('Event venue insert returned no row');
          }

          await transaction.insert(eventCategories).values(
            input.categories.map((category) => ({
              category,
              eventId: event.eventId,
            })),
          );

          await transaction.insert(eventAdminAuditLog).values({
            action: 'event.created',
            actorAdminId: input.actorAdminId,
            eventId: event.eventId,
            eventVersion: event.version,
            requestId: input.requestId,
          });

          return this.toEventRecord(event, venue, [], input.categories);
        }),
      this.spanOptions('INSERT'),
    );
  }

  list(input: ListAdminEvents): Promise<AdminEventSummaryRecord[]> {
    return runWithOperationSpan(
      'event.list_admin',
      async () => {
        const conditions: SQL[] = [isNull(events.retiredAt)];
        if (input.search !== null) {
          const escapedSearch = input.search.replace(/[\\%_]/g, '\\$&');
          conditions.push(
            sql`lower(${events.title}) LIKE ${`%${escapedSearch}%`} ESCAPE '\\'`,
          );
        }
        if (input.countryCode !== null) {
          conditions.push(eq(eventVenues.countryCode, input.countryCode));
        }
        if (input.regionCode !== null) {
          conditions.push(eq(eventVenues.regionCode, input.regionCode));
        }
        const cursorCondition = this.cursorCondition(input);
        if (cursorCondition !== undefined) conditions.push(cursorCondition);

        const order =
          input.sort === 'updated_desc'
            ? [desc(events.updatedAt), desc(events.id)]
            : input.sort === 'event_date_asc'
              ? [sql`${events.startsAt} ASC NULLS LAST`, asc(events.id)]
              : [sql`${events.startsAt} DESC NULLS LAST`, desc(events.id)];
        const results = await this.database
          .select({ event: EVENT_COLUMNS, venue: VENUE_COLUMNS })
          .from(events)
          .leftJoin(eventVenues, eq(eventVenues.eventId, events.id))
          .where(and(...conditions))
          .orderBy(...order)
          .limit(input.limit);

        if (results.length === 0) return [];

        const categories = await this.database
          .select({
            category: eventCategories.category,
            eventId: eventCategories.eventId,
          })
          .from(eventCategories)
          .where(
            inArray(
              eventCategories.eventId,
              results.map((result) => result.event.eventId),
            ),
          )
          .orderBy(eventCategories.category);
        const categoriesByEvent = this.groupCategories(categories);

        return results.map(({ event, venue }) => ({
          eventId: event.eventId,
          title: event.title,
          categories: categoriesByEvent.get(event.eventId) ?? [],
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timeZone: event.timeZone,
          venue,
          status: event.status,
          updatedAt: event.updatedAt,
        }));
      },
      this.spanOptions('SELECT'),
    );
  }

  private cursorCondition(input: ListAdminEvents): SQL | undefined {
    const cursor = input.cursor;
    if (cursor === undefined) return undefined;

    if (input.sort === 'updated_desc') {
      if (cursor.sortValue === null) return undefined;
      return or(
        lt(events.updatedAt, cursor.sortValue),
        and(
          eq(events.updatedAt, cursor.sortValue),
          lt(events.id, cursor.eventId),
        ),
      );
    }

    if (cursor.sortValue === null) {
      return and(
        isNull(events.startsAt),
        input.sort === 'event_date_asc'
          ? gt(events.id, cursor.eventId)
          : lt(events.id, cursor.eventId),
      );
    }

    const dateComparison =
      input.sort === 'event_date_asc'
        ? gt(events.startsAt, cursor.sortValue)
        : lt(events.startsAt, cursor.sortValue);
    const idComparison =
      input.sort === 'event_date_asc'
        ? gt(events.id, cursor.eventId)
        : lt(events.id, cursor.eventId);

    return or(
      dateComparison,
      isNull(events.startsAt),
      and(eq(events.startsAt, cursor.sortValue), idComparison),
    );
  }

  findById(eventId: string): Promise<EventRecord | undefined> {
    return runWithOperationSpan(
      'event.find_by_id',
      async () => {
        const [result] = await this.database
          .select({ event: EVENT_COLUMNS, venue: VENUE_COLUMNS })
          .from(events)
          .leftJoin(eventVenues, eq(eventVenues.eventId, events.id))
          .where(and(eq(events.id, eventId), isNull(events.retiredAt)))
          .limit(1);

        if (result === undefined) {
          return undefined;
        }

        const [media, categories] = await Promise.all([
          this.database
            .select(MEDIA_COLUMNS)
            .from(eventMedia)
            .where(eq(eventMedia.eventId, eventId))
            .orderBy(eventMedia.slot),
          this.database
            .select({ category: eventCategories.category })
            .from(eventCategories)
            .where(eq(eventCategories.eventId, eventId))
            .orderBy(eventCategories.category),
        ]);

        return this.toEventRecord(
          result.event,
          result.venue,
          media,
          categories.map(({ category }) => category),
        );
      },
      this.spanOptions('SELECT'),
    );
  }

  findPublishedById(eventId: string): Promise<EventRecord | undefined> {
    return runWithOperationSpan(
      'event.find_published_by_id',
      async () => {
        const [result] = await this.database
          .select({ event: EVENT_COLUMNS, venue: VENUE_COLUMNS })
          .from(events)
          .leftJoin(eventVenues, eq(eventVenues.eventId, events.id))
          .where(
            and(
              eq(events.id, eventId),
              eq(events.status, 'published'),
              isNull(events.retiredAt),
            ),
          )
          .limit(1);

        if (result === undefined) {
          return undefined;
        }

        const [media, categories] = await Promise.all([
          this.database
            .select(MEDIA_COLUMNS)
            .from(eventMedia)
            .where(eq(eventMedia.eventId, eventId))
            .orderBy(eventMedia.slot),
          this.database
            .select({ category: eventCategories.category })
            .from(eventCategories)
            .where(eq(eventCategories.eventId, eventId))
            .orderBy(eventCategories.category),
        ]);

        return this.toEventRecord(
          result.event,
          result.venue,
          media,
          categories.map(({ category }) => category),
        );
      },
      this.spanOptions('SELECT'),
    );
  }

  updateDraft(input: UpdateDraftEvent): Promise<UpdateDraftEventResult> {
    return runWithOperationSpan(
      'event.update_draft',
      () =>
        this.database.transaction(async (transaction) => {
          const [event] = await transaction
            .update(events)
            .set({
              title: input.title,
              description: input.description,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              timeZone: input.timeZone,
              updatedAt: sql`now()`,
              version: sql`${events.version} + 1`,
            })
            .where(
              and(
                eq(events.id, input.eventId),
                eq(events.status, 'draft'),
                eq(events.version, input.expectedVersion),
                isNull(events.retiredAt),
              ),
            )
            .returning(EVENT_COLUMNS);

          if (event === undefined) {
            const [existing] = await transaction
              .select({ eventId: events.id, retiredAt: events.retiredAt })
              .from(events)
              .where(eq(events.id, input.eventId))
              .limit(1);

            return existing === undefined || existing.retiredAt !== null
              ? { outcome: 'not_found' as const }
              : { outcome: 'version_conflict' as const };
          }

          const [venue] = await transaction
            .insert(eventVenues)
            .values({ eventId: input.eventId, ...input.venue })
            .onConflictDoUpdate({
              target: eventVenues.eventId,
              set: input.venue,
            })
            .returning(VENUE_COLUMNS);

          if (venue === undefined) {
            throw new Error('Event venue upsert returned no row');
          }

          await transaction
            .delete(eventCategories)
            .where(eq(eventCategories.eventId, input.eventId));
          await transaction.insert(eventCategories).values(
            input.categories.map((category) => ({
              category,
              eventId: input.eventId,
            })),
          );

          await transaction.insert(eventAdminAuditLog).values({
            action: 'event.updated',
            actorAdminId: input.actorAdminId,
            eventId: event.eventId,
            eventVersion: event.version,
            requestId: input.requestId,
          });

          const media = await transaction
            .select(MEDIA_COLUMNS)
            .from(eventMedia)
            .where(eq(eventMedia.eventId, input.eventId))
            .orderBy(eventMedia.slot);

          return {
            outcome: 'updated' as const,
            event: this.toEventRecord(event, venue, media, input.categories),
          };
        }),
      this.spanOptions('UPDATE'),
    );
  }

  publish(input: PublishEvent): Promise<PublishEventResult> {
    return runWithOperationSpan(
      'event.publish',
      () =>
        this.database.transaction(async (transaction) => {
          const [result] = await transaction
            .select({ event: EVENT_COLUMNS, venue: VENUE_COLUMNS })
            .from(events)
            .leftJoin(eventVenues, eq(eventVenues.eventId, events.id))
            .where(eq(events.id, input.eventId))
            .limit(1)
            .for('update', { of: events });

          if (result === undefined) {
            return { outcome: 'not_found' as const };
          }

          if (result.event.retiredAt !== null) {
            return { outcome: 'not_found' as const };
          }

          if (
            result.event.status !== 'draft' ||
            result.event.version !== input.expectedVersion
          ) {
            return { outcome: 'version_conflict' as const };
          }

          const [[cover], categoryRows, [ticketType]] = await Promise.all([
            transaction
              .select({ mediaId: eventMedia.id })
              .from(eventMedia)
              .where(
                and(
                  eq(eventMedia.eventId, input.eventId),
                  eq(eventMedia.slot, 'cover'),
                ),
              )
              .limit(1),
            transaction
              .select({ category: eventCategories.category })
              .from(eventCategories)
              .where(eq(eventCategories.eventId, input.eventId))
              .orderBy(eventCategories.category),
            transaction
              .select({ ticketTypeId: eventTicketTypes.id })
              .from(eventTicketTypes)
              .innerJoin(
                eventTicketCurrencies,
                eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
              )
              .where(
                and(
                  eq(eventTicketCurrencies.eventId, input.eventId),
                  isNull(eventTicketTypes.retiredAt),
                ),
              )
              .limit(1),
          ]);
          const categories = categoryRows.map(({ category }) => category);

          if (
            !this.isPublicationComplete(
              { ...result.event, categories },
              result.venue,
              cover,
              ticketType,
            )
          ) {
            return { outcome: 'incomplete' as const };
          }

          const publishedAt = new Date();
          const [event] = await transaction
            .update(events)
            .set({
              publishedAt,
              status: 'published',
              updatedAt: publishedAt,
              version: sql`${events.version} + 1`,
            })
            .where(
              and(
                eq(events.id, input.eventId),
                eq(events.status, 'draft'),
                eq(events.version, input.expectedVersion),
                isNull(events.retiredAt),
              ),
            )
            .returning(EVENT_COLUMNS);

          if (event === undefined) {
            return { outcome: 'version_conflict' as const };
          }

          await transaction.insert(eventAdminAuditLog).values({
            action: 'event.published',
            actorAdminId: input.actorAdminId,
            eventId: event.eventId,
            eventVersion: event.version,
            requestId: input.requestId,
          });

          await transaction.insert(eventPublicationOutbox).values({
            aggregateType: 'eventa.event.lifecycle.v1',
            eventId: event.eventId,
            eventType: 'event.published.v1',
            occurredAt: publishedAt,
            payload: {
              eventId: event.eventId,
              publishedAt: publishedAt.toISOString(),
              type: 'event.published.v1',
              version: event.version,
            },
          });

          const media = await transaction
            .select(MEDIA_COLUMNS)
            .from(eventMedia)
            .where(eq(eventMedia.eventId, input.eventId))
            .orderBy(eventMedia.slot);

          return {
            outcome: 'published' as const,
            event: this.toEventRecord(event, result.venue, media, categories),
          };
        }),
      this.spanOptions('UPDATE'),
    );
  }

  retire(input: RetireDraftEvent): Promise<RetireDraftEventResult> {
    return runWithOperationSpan(
      'event.retire_draft',
      () =>
        this.database.transaction(async (transaction) => {
          const [event] = await transaction
            .select({
              retiredAt: events.retiredAt,
              status: events.status,
              version: events.version,
            })
            .from(events)
            .where(eq(events.id, input.eventId))
            .limit(1)
            .for('update');

          if (event === undefined) return { outcome: 'not_found' as const };
          if (event.retiredAt !== null) {
            return {
              outcome: 'retired' as const,
              eventVersion: event.version,
            };
          }
          if (event.status !== 'draft') {
            return { outcome: 'not_draft' as const };
          }
          if (event.version !== input.expectedVersion) {
            return { outcome: 'version_conflict' as const };
          }

          const retiredAt = new Date();
          const [retired] = await transaction
            .update(events)
            .set({
              retiredAt,
              updatedAt: retiredAt,
              version: sql`${events.version} + 1`,
            })
            .where(
              and(
                eq(events.id, input.eventId),
                eq(events.status, 'draft'),
                eq(events.version, input.expectedVersion),
                isNull(events.retiredAt),
              ),
            )
            .returning({ version: events.version });
          if (retired === undefined) {
            throw new Error('Locked event changed during retirement');
          }

          await transaction.insert(eventAdminAuditLog).values({
            action: 'event.retired',
            actorAdminId: input.actorAdminId,
            eventId: input.eventId,
            eventVersion: retired.version,
            requestId: input.requestId,
          });

          return {
            outcome: 'retired' as const,
            eventVersion: retired.version,
          };
        }),
      this.spanOptions('UPDATE'),
    );
  }

  private isPublicationComplete(
    event: Pick<
      EventRecord,
      'categories' | 'description' | 'endsAt' | 'startsAt' | 'timeZone'
    >,
    venue: EventVenue | null,
    cover: { mediaId: string } | undefined,
    ticketType: { ticketTypeId: string } | undefined,
  ): boolean {
    return (
      event.description !== null &&
      event.categories.length > 0 &&
      event.startsAt !== null &&
      event.endsAt !== null &&
      event.timeZone !== null &&
      venue !== null &&
      cover !== undefined &&
      ticketType !== undefined
    );
  }

  private toEventRecord(
    event: Omit<EventRecord, 'categories' | 'venue' | 'media'>,
    venue: EventVenue | null,
    media: EventMediaRecord[],
    categories: string[],
  ): EventRecord {
    return { ...event, categories, venue, media };
  }

  private groupCategories(
    rows: Array<{ eventId: string; category: string }>,
  ): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const values = grouped.get(row.eventId) ?? [];
      values.push(row.category);
      grouped.set(row.eventId, values);
    }
    return grouped;
  }

  private spanOptions(operation: string): {
    attributes: Record<string, string>;
    kind: 'client';
  } {
    return {
      attributes: {
        'db.collection.name': 'events',
        'db.namespace': 'eventa_event',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client',
    };
  }
}
