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

export const eventMediaObjectDeletions = pgTable(
  'event_media_object_deletions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull(),
    objectKey: text('object_key').notNull(),
    reason: text('reason').$type<'replaced' | 'removed'>().notNull(),
    status: text('status')
      .$type<'pending' | 'deleted' | 'failed'>()
      .default('pending')
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
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
    claimToken: uuid('claim_token'),
    claimExpiresAt: timestamp('claim_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    deletedAt: timestamp('deleted_at', {
      mode: 'date',
      withTimezone: true,
    }),
    failedAt: timestamp('failed_at', {
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
    uniqueIndex('event_media_object_deletions_object_key_unique').on(
      table.objectKey,
    ),
    index('event_media_object_deletions_dispatch_index').on(
      table.status,
      table.nextAttemptAt,
      table.jobPublishedAt,
    ),
    check(
      'event_media_object_deletions_reason_allowed',
      sql`${table.reason} IN ('replaced', 'removed')`,
    ),
    check(
      'event_media_object_deletions_status_allowed',
      sql`${table.status} IN ('pending', 'deleted', 'failed')`,
    ),
    check(
      'event_media_object_deletions_attempt_count_bounded',
      sql`${table.attemptCount} BETWEEN 0 AND 10`,
    ),
    check(
      'event_media_object_deletions_terminal_shape',
      sql`(${table.status} = 'pending' AND ${table.deletedAt} IS NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'deleted' AND ${table.deletedAt} IS NOT NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'failed' AND ${table.deletedAt} IS NULL AND ${table.failedAt} IS NOT NULL)`,
    ),
  ],
);
