import { Inject } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import {
  EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
  EVENT_MEDIA_OBJECT_DELETION_QUEUE,
  EVENT_MEDIA_VERIFICATION_JOB_TYPE,
  EVENT_MEDIA_VERIFICATION_QUEUE,
} from '../constants/event-media.constants';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
import { eventJobOutbox } from '../schema/event-job-outbox.schema';
import { eventMediaObjectDeletions } from '../schema/event-media-object-deletion.schema';
import { eventMediaUploads } from '../schema/event-media-upload.schema';
import { eventMedia } from '../schema/event-media.schema';
import { events } from '../schema/event.schema';
import type {
  AttachVerifiedEventMediaResult,
  CreateEventMediaUploadCommand,
  CreateEventMediaUploadResult,
  EventMediaUploadRecord,
  EventMediaUploadRepository as EventMediaUploadRepositoryPort,
  EventMediaUploadStatusRecord,
  VerifiedEventMediaObject,
} from '../types/event.types';

const UPLOAD_COLUMNS = {
  uploadId: eventMediaUploads.id,
  eventId: eventMediaUploads.eventId,
  actorAdminId: eventMediaUploads.actorAdminId,
  requestId: eventMediaUploads.requestId,
  slot: eventMediaUploads.slot,
  objectKey: eventMediaUploads.objectKey,
  expectedEventVersion: eventMediaUploads.expectedEventVersion,
  declaredContentType: eventMediaUploads.declaredContentType,
  declaredSizeBytes: eventMediaUploads.declaredSizeBytes,
  status: eventMediaUploads.status,
  failureCode: eventMediaUploads.failureCode,
  attachedEventVersion: eventMediaUploads.attachedEventVersion,
  expiresAt: eventMediaUploads.expiresAt,
  verificationDeadlineAt: eventMediaUploads.verificationDeadlineAt,
  attemptCount: eventMediaUploads.attemptCount,
  objectDeletionAttemptCount: eventMediaUploads.objectDeletionAttemptCount,
  claimToken: eventMediaUploads.claimToken,
  objectDeletedAt: eventMediaUploads.objectDeletedAt,
  objectDeletionFailedAt: eventMediaUploads.objectDeletionFailedAt,
};

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === '23505' &&
    Reflect.get(error, 'constraint_name') === constraint
  );
}

export class EventMediaUploadRepository implements EventMediaUploadRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  async createUpload(
    input: {
      uploadId: string;
      objectKey: string;
      expiresAt: Date;
      verificationDeadlineAt: Date;
    } & CreateEventMediaUploadCommand,
  ): Promise<CreateEventMediaUploadResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        const createdAt = new Date();
        const [event] = await transaction
          .select({
            id: events.id,
            retiredAt: events.retiredAt,
            status: events.status,
            version: events.version,
          })
          .from(events)
          .where(eq(events.id, input.eventId))
          .for('update');

        if (event === undefined || event.retiredAt !== null) {
          return { outcome: 'not_found' as const };
        }
        if (
          event.status !== 'draft' ||
          event.version !== input.expectedVersion
        ) {
          return { outcome: 'version_conflict' as const };
        }

        const [upload] = await transaction
          .insert(eventMediaUploads)
          .values({
            id: input.uploadId,
            eventId: input.eventId,
            actorAdminId: input.actorAdminId,
            requestId: input.requestId,
            slot: input.slot,
            objectKey: input.objectKey,
            expectedEventVersion: input.expectedVersion,
            declaredContentType: input.contentType,
            declaredSizeBytes: input.sizeBytes,
            expiresAt: input.expiresAt,
            jobPublishedAt: createdAt,
            verificationDeadlineAt: input.verificationDeadlineAt,
          })
          .returning(UPLOAD_COLUMNS);

        if (upload === undefined) {
          throw new Error('Event media upload insert returned no row');
        }

        await transaction.insert(eventJobOutbox).values({
          aggregateType: 'eventa.event.jobs',
          eventType: EVENT_MEDIA_VERIFICATION_JOB_TYPE,
          occurredAt: createdAt,
          payload: {
            type: EVENT_MEDIA_VERIFICATION_JOB_TYPE,
            uploadId: upload.uploadId,
          },
          routingKey: EVENT_MEDIA_VERIFICATION_QUEUE,
        });

        await transaction.insert(eventAdminAuditLog).values({
          action: 'event.media_upload_requested',
          actorAdminId: input.actorAdminId,
          eventId: input.eventId,
          eventVersion: event.version,
          requestId: input.requestId,
        });

        return { outcome: 'created' as const, upload };
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error, 'event_media_uploads_active_slot_unique')) {
        return { outcome: 'upload_in_progress' };
      }
      throw error;
    }
  }

  async findStatus(
    eventId: string,
    uploadId: string,
  ): Promise<EventMediaUploadStatusRecord | undefined> {
    const [upload] = await this.database
      .select({
        uploadId: eventMediaUploads.id,
        slot: eventMediaUploads.slot,
        status: eventMediaUploads.status,
        expiresAt: eventMediaUploads.expiresAt,
        verificationDeadlineAt: eventMediaUploads.verificationDeadlineAt,
        attachedEventVersion: eventMediaUploads.attachedEventVersion,
        failureCode: eventMediaUploads.failureCode,
      })
      .from(eventMediaUploads)
      .innerJoin(events, eq(events.id, eventMediaUploads.eventId))
      .where(
        and(
          eq(eventMediaUploads.id, uploadId),
          eq(eventMediaUploads.eventId, eventId),
          isNull(events.retiredAt),
        ),
      )
      .limit(1);
    return upload;
  }

  claimDispatchable(
    limit: number,
    leaseExpiresBefore: Date,
  ): Promise<string[]> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({ uploadId: eventMediaUploads.id })
        .from(eventMediaUploads)
        .where(
          and(
            or(
              eq(eventMediaUploads.status, 'pending'),
              and(
                inArray(eventMediaUploads.status, [
                  'rejected',
                  'conflict',
                  'expired',
                ]),
                isNull(eventMediaUploads.objectDeletedAt),
                isNull(eventMediaUploads.objectDeletionFailedAt),
              ),
            ),
            lte(eventMediaUploads.nextAttemptAt, sql`now()`),
            or(
              isNull(eventMediaUploads.jobPublishedAt),
              and(
                lt(eventMediaUploads.jobPublishedAt, leaseExpiresBefore),
                or(
                  isNull(eventMediaUploads.claimExpiresAt),
                  lt(eventMediaUploads.claimExpiresAt, sql`now()`),
                ),
              ),
            ),
          ),
        )
        .orderBy(eventMediaUploads.nextAttemptAt)
        .limit(limit)
        .for('update', { skipLocked: true });

      const uploadIds = rows.map((row) => row.uploadId);
      if (uploadIds.length === 0) return [];

      await transaction
        .update(eventMediaUploads)
        .set({
          claimExpiresAt: null,
          claimToken: null,
          jobPublishedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(eventMediaUploads.id, uploadIds));
      return uploadIds;
    });
  }

  async markDispatchFailed(uploadId: string): Promise<void> {
    await this.database
      .update(eventMediaUploads)
      .set({ jobPublishedAt: null, updatedAt: new Date() })
      .where(eq(eventMediaUploads.id, uploadId));
  }

  async claim(
    uploadId: string,
    claimToken: string,
    claimExpiresAt: Date,
  ): Promise<EventMediaUploadRecord | undefined> {
    const [upload] = await this.database
      .update(eventMediaUploads)
      .set({
        claimToken,
        claimExpiresAt,
        attemptCount: sql`${eventMediaUploads.attemptCount} + CASE WHEN ${eventMediaUploads.status} = 'pending' THEN 1 ELSE 0 END`,
        objectDeletionAttemptCount: sql`${eventMediaUploads.objectDeletionAttemptCount} + CASE WHEN ${eventMediaUploads.status} IN ('rejected', 'conflict', 'expired') THEN 1 ELSE 0 END`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(eventMediaUploads.id, uploadId),
          or(
            eq(eventMediaUploads.status, 'pending'),
            and(
              inArray(eventMediaUploads.status, [
                'rejected',
                'conflict',
                'expired',
              ]),
              isNull(eventMediaUploads.objectDeletedAt),
              isNull(eventMediaUploads.objectDeletionFailedAt),
            ),
          ),
          or(
            isNull(eventMediaUploads.claimExpiresAt),
            lt(eventMediaUploads.claimExpiresAt, sql`now()`),
          ),
          lte(eventMediaUploads.nextAttemptAt, sql`now()`),
        ),
      )
      .returning(UPLOAD_COLUMNS);
    return upload;
  }

  async scheduleRetry(
    uploadId: string,
    claimToken: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.database
      .update(eventMediaUploads)
      .set({
        claimToken: null,
        claimExpiresAt: null,
        jobPublishedAt: null,
        nextAttemptAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventMediaUploads.id, uploadId),
          eq(eventMediaUploads.claimToken, claimToken),
        ),
      );
  }

  async markTerminal(
    uploadId: string,
    claimToken: string,
    status: 'rejected' | 'expired',
    failureCode: string,
  ): Promise<EventMediaUploadRecord> {
    const [upload] = await this.database
      .update(eventMediaUploads)
      .set({ status, failureCode, updatedAt: new Date() })
      .where(
        and(
          eq(eventMediaUploads.id, uploadId),
          eq(eventMediaUploads.status, 'pending'),
          eq(eventMediaUploads.claimToken, claimToken),
        ),
      )
      .returning(UPLOAD_COLUMNS);
    if (upload === undefined) {
      throw new Error('Event media upload terminal transition failed');
    }
    return upload;
  }

  attachVerified(
    upload: EventMediaUploadRecord,
    verified: VerifiedEventMediaObject,
  ): Promise<AttachVerifiedEventMediaResult> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select(UPLOAD_COLUMNS)
        .from(eventMediaUploads)
        .where(eq(eventMediaUploads.id, upload.uploadId))
        .for('update');

      if (current === undefined) {
        throw new Error('Event media upload disappeared');
      }
      if (current.status !== 'pending') {
        return { outcome: 'already_terminal' as const, upload: current };
      }
      if (current.claimToken !== upload.claimToken) {
        throw new Error('Event media upload claim was lost');
      }

      const [event] = await transaction
        .update(events)
        .set({
          version: sql`${events.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(events.id, current.eventId),
            eq(events.status, 'draft'),
            eq(events.version, current.expectedEventVersion),
            isNull(events.retiredAt),
          ),
        )
        .returning({ version: events.version });

      if (event === undefined) {
        const [conflict] = await transaction
          .update(eventMediaUploads)
          .set({
            status: 'conflict',
            failureCode: 'EVENT_MEDIA_VERSION_CONFLICT',
            updatedAt: new Date(),
          })
          .where(eq(eventMediaUploads.id, current.uploadId))
          .returning(UPLOAD_COLUMNS);
        if (conflict === undefined) {
          throw new Error('Event media conflict transition failed');
        }
        return { outcome: 'conflict' as const, upload: conflict };
      }

      const [replacedMedia] = await transaction
        .delete(eventMedia)
        .where(
          and(
            eq(eventMedia.eventId, current.eventId),
            eq(eventMedia.slot, current.slot),
          ),
        )
        .returning({ objectKey: eventMedia.objectKey });

      await transaction.insert(eventMedia).values({
        id: current.uploadId,
        eventId: current.eventId,
        slot: current.slot,
        objectKey: current.objectKey,
        ...verified,
      });

      await transaction
        .update(eventMediaUploads)
        .set({
          status: 'attached',
          attachedEventVersion: event.version,
          claimToken: null,
          claimExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(eventMediaUploads.id, current.uploadId));

      await transaction.insert(eventAdminAuditLog).values({
        action:
          replacedMedia === undefined
            ? 'event.media_attached'
            : 'event.media_replaced',
        actorAdminId: current.actorAdminId,
        eventId: current.eventId,
        eventVersion: event.version,
        requestId: current.requestId,
      });

      if (replacedMedia !== undefined) {
        const createdAt = new Date();
        const [deletion] = await transaction
          .insert(eventMediaObjectDeletions)
          .values({
            eventId: current.eventId,
            jobPublishedAt: createdAt,
            objectKey: replacedMedia.objectKey,
            reason: 'replaced',
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
      }

      return {
        outcome: 'attached' as const,
        mutation:
          replacedMedia === undefined
            ? ('attached' as const)
            : ('replaced' as const),
        eventVersion: event.version,
      };
    });
  }

  async markObjectDeleted(uploadId: string, claimToken: string): Promise<void> {
    await this.database
      .update(eventMediaUploads)
      .set({
        objectDeletedAt: new Date(),
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventMediaUploads.id, uploadId),
          eq(eventMediaUploads.claimToken, claimToken),
        ),
      );
  }

  async markObjectDeletionFailed(
    uploadId: string,
    claimToken: string,
  ): Promise<void> {
    await this.database
      .update(eventMediaUploads)
      .set({
        objectDeletionFailedAt: new Date(),
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventMediaUploads.id, uploadId),
          eq(eventMediaUploads.claimToken, claimToken),
        ),
      );
  }
}
