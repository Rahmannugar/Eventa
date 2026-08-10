import { Inject } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';
import { and, eq, sql } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
import { eventMedia } from '../schema/event-media.schema';
import { eventPublicationOutbox } from '../schema/event-publication-outbox.schema';
import { eventVenues } from '../schema/event-venue.schema';
import { events } from '../schema/event.schema';
import type {
  CreateDraftEvent,
  EventVenue,
  EventMediaRecord,
  EventRecord,
  EventRepository as EventRepositoryPort,
  PublishEvent,
  PublishEventResult,
  UpdateDraftEvent,
  UpdateDraftEventResult,
} from '../types/event.types';

const EVENT_COLUMNS = {
  eventId: events.id,
  title: events.title,
  description: events.description,
  category: events.category,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  timeZone: events.timeZone,
  status: events.status,
  version: events.version,
  createdByAdminId: events.createdByAdminId,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
  publishedAt: events.publishedAt,
};

const VENUE_COLUMNS = {
  name: eventVenues.name,
  addressLine1: eventVenues.addressLine1,
  addressLine2: eventVenues.addressLine2,
  city: eventVenues.city,
  region: eventVenues.region,
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

export class EventRepository implements EventRepositoryPort {
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
              title: input.title,
            })
            .returning(EVENT_COLUMNS);

          if (event === undefined) {
            throw new Error('Event insert returned no row');
          }

          await transaction.insert(eventAdminAuditLog).values({
            action: 'event.created',
            actorAdminId: input.actorAdminId,
            eventId: event.eventId,
            eventVersion: event.version,
            requestId: input.requestId,
          });

          return this.toEventRecord(event, null, []);
        }),
      this.spanOptions('INSERT'),
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
          .where(eq(events.id, eventId))
          .limit(1);

        if (result === undefined) {
          return undefined;
        }

        const media = await this.database
          .select(MEDIA_COLUMNS)
          .from(eventMedia)
          .where(eq(eventMedia.eventId, eventId))
          .orderBy(eventMedia.slot);

        return this.toEventRecord(result.event, result.venue, media);
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
              category: input.category,
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
              ),
            )
            .returning(EVENT_COLUMNS);

          if (event === undefined) {
            const [existing] = await transaction
              .select({ eventId: events.id })
              .from(events)
              .where(eq(events.id, input.eventId))
              .limit(1);

            return existing === undefined
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
            event: this.toEventRecord(event, venue, media),
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

          if (
            result.event.status !== 'draft' ||
            result.event.version !== input.expectedVersion
          ) {
            return { outcome: 'version_conflict' as const };
          }

          const [cover] = await transaction
            .select({ mediaId: eventMedia.id })
            .from(eventMedia)
            .where(
              and(
                eq(eventMedia.eventId, input.eventId),
                eq(eventMedia.slot, 'cover'),
              ),
            )
            .limit(1);

          if (!this.isPublicationComplete(result.event, result.venue, cover)) {
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
            event: this.toEventRecord(event, result.venue, media),
          };
        }),
      this.spanOptions('UPDATE'),
    );
  }

  private isPublicationComplete(
    event: Pick<
      EventRecord,
      'category' | 'description' | 'endsAt' | 'startsAt' | 'timeZone'
    >,
    venue: EventVenue | null,
    cover: { mediaId: string } | undefined,
  ): boolean {
    return (
      event.description !== null &&
      event.category !== null &&
      event.startsAt !== null &&
      event.endsAt !== null &&
      event.timeZone !== null &&
      venue !== null &&
      cover !== undefined
    );
  }

  private toEventRecord(
    event: Omit<EventRecord, 'venue' | 'media'>,
    venue: EventVenue | null,
    media: EventMediaRecord[],
  ): EventRecord {
    return { ...event, venue, media };
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
