import { sql } from 'drizzle-orm';
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { EventWaitlistEntryEligibleEvent } from '@eventa/messaging-contracts/event/event-waitlist.events';

export const eventWaitlistOutbox = pgTable(
  'event_waitlist_outbox',
  {
    factId: uuid('event_id').primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload')
      .$type<EventWaitlistEntryEligibleEvent>()
      .notNull(),
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
      'event_waitlist_outbox_aggregate_type_valid',
      sql`${table.aggregateType} = 'eventa.event.waitlist.v1'`,
    ),
    check(
      'event_waitlist_outbox_event_type_valid',
      sql`${table.eventType} = 'event.waitlist-entry.eligible.v1'`,
    ),
  ],
);
