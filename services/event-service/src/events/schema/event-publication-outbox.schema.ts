import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { EventPublishedFact } from '../types/event.types';

export const eventPublicationOutbox = pgTable(
  'event_publication_outbox',
  {
    eventId: uuid('event_id').primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<EventPublishedFact>().notNull(),
    occurredAt: timestamp('occurred_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'event_publication_outbox_aggregate_type_valid',
      sql`${table.aggregateType} = 'eventa.event.lifecycle.v1'`,
    ),
    check(
      'event_publication_outbox_event_type_valid',
      sql`${table.eventType} = 'event.published.v1'`,
    ),
  ],
);
