import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const cancellationEmailDeliveries = pgTable(
  'cancellation_email_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull(),
    attendeeId: uuid('attendee_id').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').default(0).notNull(),
    providerMessageId: text('provider_message_id'),
    failureCode: text('failure_code'),
    processingToken: uuid('processing_token'),
    leaseExpiresAt: timestamp('lease_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    nextAttemptAt: timestamp('next_attempt_at', {
      mode: 'date',
      withTimezone: true,
    }),
    deliveredAt: timestamp('delivered_at', {
      mode: 'date',
      withTimezone: true,
    }),
    terminalAt: timestamp('terminal_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('cancellation_email_deliveries_event_attendee_unique').on(
      table.eventId,
      table.attendeeId,
    ),
    check(
      'cancellation_email_deliveries_status_valid',
      sql`${table.status} IN ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'rejected')`,
    ),
    check(
      'cancellation_email_deliveries_attempt_count_valid',
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 3`,
    ),
    index('cancellation_email_deliveries_status_idx').on(table.status),
    index('cancellation_email_deliveries_next_attempt_idx').on(
      table.nextAttemptAt,
    ),
  ],
);
