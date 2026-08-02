import { Inject } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { EVENT_MEDIA_MAX_OBJECT_DELETION_ATTEMPTS } from '../constants/event-media.constants';
import { eventMediaObjectDeletions } from '../schema/event-media-object-deletion.schema';
import type {
  EventMediaObjectDeletionRecord,
  EventMediaObjectDeletionRepository as EventMediaObjectDeletionRepositoryPort,
} from '../types/event.types';

const DELETION_COLUMNS = {
  deletionId: eventMediaObjectDeletions.id,
  eventId: eventMediaObjectDeletions.eventId,
  objectKey: eventMediaObjectDeletions.objectKey,
  reason: eventMediaObjectDeletions.reason,
  status: eventMediaObjectDeletions.status,
  attemptCount: eventMediaObjectDeletions.attemptCount,
  claimToken: eventMediaObjectDeletions.claimToken,
};

export class EventMediaObjectDeletionRepository implements EventMediaObjectDeletionRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  claimDispatchable(
    limit: number,
    leaseExpiresBefore: Date,
  ): Promise<string[]> {
    return this.database.transaction(async (transaction) => {
      const now = new Date();
      const rows = await transaction
        .select({ deletionId: eventMediaObjectDeletions.id })
        .from(eventMediaObjectDeletions)
        .where(
          and(
            eq(eventMediaObjectDeletions.status, 'pending'),
            lte(eventMediaObjectDeletions.nextAttemptAt, now),
            or(
              isNull(eventMediaObjectDeletions.jobPublishedAt),
              and(
                lt(
                  eventMediaObjectDeletions.jobPublishedAt,
                  leaseExpiresBefore,
                ),
                or(
                  isNull(eventMediaObjectDeletions.claimExpiresAt),
                  lt(eventMediaObjectDeletions.claimExpiresAt, now),
                ),
              ),
            ),
          ),
        )
        .orderBy(eventMediaObjectDeletions.nextAttemptAt)
        .limit(limit)
        .for('update', { skipLocked: true });

      const deletionIds = rows.map((row) => row.deletionId);
      if (deletionIds.length === 0) return [];

      await transaction
        .update(eventMediaObjectDeletions)
        .set({
          claimExpiresAt: null,
          claimToken: null,
          jobPublishedAt: now,
          updatedAt: now,
        })
        .where(inArray(eventMediaObjectDeletions.id, deletionIds));
      return deletionIds;
    });
  }

  async markDispatchFailed(deletionId: string): Promise<void> {
    await this.database
      .update(eventMediaObjectDeletions)
      .set({ jobPublishedAt: null, updatedAt: new Date() })
      .where(eq(eventMediaObjectDeletions.id, deletionId));
  }

  async claim(
    deletionId: string,
    claimToken: string,
    claimExpiresAt: Date,
  ): Promise<EventMediaObjectDeletionRecord | undefined> {
    const now = new Date();
    const [deletion] = await this.database
      .update(eventMediaObjectDeletions)
      .set({ claimExpiresAt, claimToken, updatedAt: now })
      .where(
        and(
          eq(eventMediaObjectDeletions.id, deletionId),
          eq(eventMediaObjectDeletions.status, 'pending'),
          lte(eventMediaObjectDeletions.nextAttemptAt, now),
          or(
            isNull(eventMediaObjectDeletions.claimExpiresAt),
            lt(eventMediaObjectDeletions.claimExpiresAt, now),
          ),
        ),
      )
      .returning(DELETION_COLUMNS);
    return deletion;
  }

  recordFailure(
    deletionId: string,
    claimToken: string,
    nextAttemptAt: Date,
  ): Promise<'retry' | 'failed'> {
    return this.database.transaction(async (transaction) => {
      const [deletion] = await transaction
        .select({ attemptCount: eventMediaObjectDeletions.attemptCount })
        .from(eventMediaObjectDeletions)
        .where(
          and(
            eq(eventMediaObjectDeletions.id, deletionId),
            eq(eventMediaObjectDeletions.status, 'pending'),
            eq(eventMediaObjectDeletions.claimToken, claimToken),
          ),
        )
        .for('update');
      if (deletion === undefined) {
        throw new Error('Event media object deletion claim was lost');
      }

      const attemptCount = deletion.attemptCount + 1;
      const failed = attemptCount >= EVENT_MEDIA_MAX_OBJECT_DELETION_ATTEMPTS;
      await transaction
        .update(eventMediaObjectDeletions)
        .set({
          attemptCount,
          claimExpiresAt: null,
          claimToken: null,
          failedAt: failed ? new Date() : null,
          jobPublishedAt: null,
          nextAttemptAt,
          status: failed ? 'failed' : 'pending',
          updatedAt: new Date(),
        })
        .where(eq(eventMediaObjectDeletions.id, deletionId));
      return failed ? 'failed' : 'retry';
    });
  }

  async markDeleted(deletionId: string, claimToken: string): Promise<void> {
    const [deleted] = await this.database
      .update(eventMediaObjectDeletions)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        deletedAt: new Date(),
        status: 'deleted',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventMediaObjectDeletions.id, deletionId),
          eq(eventMediaObjectDeletions.status, 'pending'),
          eq(eventMediaObjectDeletions.claimToken, claimToken),
        ),
      )
      .returning({ deletionId: eventMediaObjectDeletions.id });
    if (deleted === undefined) {
      throw new Error('Event media object deletion claim was lost');
    }
  }
}
