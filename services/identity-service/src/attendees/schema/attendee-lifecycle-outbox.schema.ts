import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { AttendeeDeletedEvent } from '@eventa/messaging-contracts/identity/attendee-lifecycle.events';

export const attendeeLifecycleOutbox = pgTable(
  'attendee_lifecycle_outbox',
  {
    eventId: uuid('event_id').primaryKey(),
    attendeeId: uuid('attendee_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<AttendeeDeletedEvent>().notNull(),
    occurredAt: timestamp('occurred_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    publishedAt: timestamp('published_at', {
      mode: 'date',
      withTimezone: true,
    }),
    attemptCount: integer('attempt_count').default(0).notNull(),
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
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'attendee_lifecycle_outbox_event_type_valid',
      sql`${table.eventType} = 'attendee.deleted.v1'`,
    ),
    check(
      'attendee_lifecycle_outbox_attempt_count_valid',
      sql`${table.attemptCount} >= 0`,
    ),
    index('attendee_lifecycle_outbox_pending_idx').on(
      table.publishedAt,
      table.nextAttemptAt,
      table.occurredAt,
    ),
  ],
);
