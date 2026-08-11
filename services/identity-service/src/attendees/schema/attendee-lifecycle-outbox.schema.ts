import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { AttendeeDeletedEvent } from '@eventa/messaging-contracts/identity/attendee-lifecycle.events';

export const attendeeLifecycleOutbox = pgTable(
  'attendee_lifecycle_outbox',
  {
    eventId: uuid('event_id').primaryKey(),
    attendeeId: uuid('attendee_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<AttendeeDeletedEvent>().notNull(),
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
      'attendee_lifecycle_outbox_aggregate_type_valid',
      sql`${table.aggregateType} = 'eventa.identity.attendee-lifecycle.v1'`,
    ),
    check(
      'attendee_lifecycle_outbox_event_type_valid',
      sql`${table.eventType} = 'attendee.deleted.v1'`,
    ),
  ],
);
