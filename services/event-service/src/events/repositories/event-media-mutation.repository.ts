import { Inject } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import {
  EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
  EVENT_MEDIA_OBJECT_DELETION_QUEUE,
} from '../constants/event-media.constants';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
import { eventJobOutbox } from '../schema/event-job-outbox.schema';
import { eventMediaObjectDeletions } from '../schema/event-media-object-deletion.schema';
import { eventMedia } from '../schema/event-media.schema';
import { events } from '../schema/event.schema';
import type {
  EventMediaMutationRepository as EventMediaMutationRepositoryPort,
  RemoveEventMediaCommand,
  RemoveEventMediaResult,
} from '../types/event.types';

export class EventMediaMutationRepository implements EventMediaMutationRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  remove(input: RemoveEventMediaCommand): Promise<RemoveEventMediaResult> {
    return this.database.transaction(async (transaction) => {
      const [event] = await transaction
        .select({
          retiredAt: events.retiredAt,
          status: events.status,
          version: events.version,
        })
        .from(events)
        .where(eq(events.id, input.eventId))
        .for('update');

      if (event === undefined || event.retiredAt !== null) {
        return { outcome: 'not_found' };
      }
      if (event.status !== 'draft' || event.version !== input.expectedVersion) {
        return { outcome: 'version_conflict' };
      }

      const [removed] = await transaction
        .delete(eventMedia)
        .where(
          and(
            eq(eventMedia.eventId, input.eventId),
            eq(eventMedia.slot, input.slot),
          ),
        )
        .returning({ objectKey: eventMedia.objectKey });
      if (removed === undefined) return { outcome: 'media_not_found' };

      const [updated] = await transaction
        .update(events)
        .set({
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
        .returning({ version: events.version });
      if (updated === undefined) {
        throw new Error('Locked event changed during media removal');
      }

      const createdAt = new Date();
      const [deletion] = await transaction
        .insert(eventMediaObjectDeletions)
        .values({
          eventId: input.eventId,
          jobPublishedAt: createdAt,
          objectKey: removed.objectKey,
          reason: 'removed',
        })
        .returning({ deletionId: eventMediaObjectDeletions.id });
      if (deletion === undefined) {
        throw new Error('Event media object deletion insert returned no row');
      }
      await transaction.insert(eventJobOutbox).values({
        aggregateType: 'eventa.event.jobs',
        eventType: EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
        occurredAt: createdAt,
        payload: {
          deletionId: deletion.deletionId,
          type: EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
        },
        routingKey: EVENT_MEDIA_OBJECT_DELETION_QUEUE,
      });
      await transaction.insert(eventAdminAuditLog).values({
        action: 'event.media_removed',
        actorAdminId: input.actorAdminId,
        eventId: input.eventId,
        eventVersion: updated.version,
        requestId: input.requestId,
      });

      return { outcome: 'removed', eventVersion: updated.version };
    });
  }
}
