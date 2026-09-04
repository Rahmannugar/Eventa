import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const commerceOrderOutbox = pgTable('commerce_order_outbox', {
  eventId: uuid('event_id').primaryKey(),
  aggregateType: varchar('aggregate_type', { length: 120 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: varchar('event_type', { length: 120 }).notNull(),
  payload: jsonb('payload').notNull(),
  occurredAt: timestamp('occurred_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});
