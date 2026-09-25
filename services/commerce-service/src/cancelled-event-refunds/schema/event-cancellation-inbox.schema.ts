import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const commerceEventCancellationInbox = pgTable(
  'commerce_event_cancellation_inbox',
  {
    messageId: uuid('message_id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('received'),
    receivedAt: timestamp('received_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    processedAt: timestamp('processed_at', {
      mode: 'date',
      withTimezone: true,
    }),
  },
  (table) => [
    index('commerce_event_cancellation_inbox_event_index').on(table.eventId),
    check(
      'commerce_event_cancellation_inbox_event_type_shape',
      sql.raw("event_type = 'event.cancelled.v1'"),
    ),
    check(
      'commerce_event_cancellation_inbox_status_shape',
      sql.raw("status IN ('received', 'processed', 'failed')"),
    ),
    check(
      'commerce_event_cancellation_inbox_processed_shape',
      sql.raw(
        "(status = 'processed' AND processed_at IS NOT NULL) OR (status <> 'processed' AND processed_at IS NULL)",
      ),
    ),
  ],
);
