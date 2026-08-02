import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { events } from './event.schema';

export type EventMediaSlot =
  'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';

export type EventMediaUploadStatus =
  'pending' | 'attached' | 'rejected' | 'conflict' | 'expired';

export const eventMediaUploads = pgTable(
  'event_media_uploads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    actorAdminId: uuid('actor_admin_id').notNull(),
    requestId: text('request_id').notNull(),
    slot: text('slot').$type<EventMediaSlot>().notNull(),
    objectKey: text('object_key').notNull(),
    expectedEventVersion: integer('expected_event_version').notNull(),
    declaredContentType: text('declared_content_type')
      .$type<'image/jpeg' | 'image/png' | 'image/webp'>()
      .notNull(),
    declaredSizeBytes: integer('declared_size_bytes').notNull(),
    status: text('status')
      .$type<EventMediaUploadStatus>()
      .default('pending')
      .notNull(),
    failureCode: text('failure_code'),
    attachedEventVersion: integer('attached_event_version'),
    expiresAt: timestamp('expires_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    verificationDeadlineAt: timestamp('verification_deadline_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    jobPublishedAt: timestamp('job_published_at', {
      mode: 'date',
      withTimezone: true,
    }),
    nextAttemptAt: timestamp('next_attempt_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    objectDeletionAttemptCount: integer('object_deletion_attempt_count')
      .default(0)
      .notNull(),
    claimToken: uuid('claim_token'),
    claimExpiresAt: timestamp('claim_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    objectDeletedAt: timestamp('object_deleted_at', {
      mode: 'date',
      withTimezone: true,
    }),
    objectDeletionFailedAt: timestamp('object_deletion_failed_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('event_media_uploads_object_key_unique').on(table.objectKey),
    uniqueIndex('event_media_uploads_active_slot_unique')
      .on(table.eventId, table.slot)
      .where(sql`${table.status} = 'pending'`),
    index('event_media_uploads_dispatch_index').on(
      table.status,
      table.nextAttemptAt,
      table.jobPublishedAt,
    ),
    check(
      'event_media_uploads_slot_allowed',
      sql`${table.slot} IN ('cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4')`,
    ),
    check(
      'event_media_uploads_status_allowed',
      sql`${table.status} IN ('pending', 'attached', 'rejected', 'conflict', 'expired')`,
    ),
    check(
      'event_media_uploads_content_type_allowed',
      sql`${table.declaredContentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      'event_media_uploads_size_allowed',
      sql`${table.declaredSizeBytes} BETWEEN 1 AND 8388608`,
    ),
    check(
      'event_media_uploads_expected_version_positive',
      sql`${table.expectedEventVersion} >= 1`,
    ),
    check(
      'event_media_uploads_verification_deadline_after_upload',
      sql`${table.verificationDeadlineAt} > ${table.expiresAt}`,
    ),
    check(
      'event_media_uploads_attempt_count_nonnegative',
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      'event_media_uploads_object_deletion_attempt_count_nonnegative',
      sql`${table.objectDeletionAttemptCount} >= 0`,
    ),
    check(
      'event_media_uploads_request_id_length',
      sql`char_length(${table.requestId}) BETWEEN 1 AND 128`,
    ),
    check(
      'event_media_uploads_terminal_shape',
      sql`(${table.status} = 'attached' AND ${table.attachedEventVersion} IS NOT NULL AND ${table.failureCode} IS NULL) OR (${table.status} = 'pending' AND ${table.attachedEventVersion} IS NULL AND ${table.failureCode} IS NULL) OR (${table.status} IN ('rejected', 'conflict', 'expired') AND ${table.attachedEventVersion} IS NULL AND ${table.failureCode} IS NOT NULL)`,
    ),
    check(
      'event_media_uploads_object_deletion_shape',
      sql`NOT (${table.objectDeletedAt} IS NOT NULL AND ${table.objectDeletionFailedAt} IS NOT NULL) AND (${table.status} IN ('rejected', 'conflict', 'expired') OR (${table.objectDeletionAttemptCount} = 0 AND ${table.objectDeletedAt} IS NULL AND ${table.objectDeletionFailedAt} IS NULL))`,
    ),
  ],
);
