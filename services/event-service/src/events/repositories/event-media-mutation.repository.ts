import { Inject } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
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
        .select({ status: events.status, version: events.version })
        .from(events)
        .where(eq(events.id, input.eventId))
        .for('update');

      if (event === undefined) return { outcome: 'not_found' };
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
          ),
        )
        .returning({ version: events.version });
      if (updated === undefined) {
        throw new Error('Locked event changed during media removal');
      }

      await transaction.insert(eventMediaObjectDeletions).values({
        eventId: input.eventId,
        objectKey: removed.objectKey,
        reason: 'removed',
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
