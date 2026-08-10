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

import type { EventPublishedFact } from '../types/event.types';

export const eventPublicationOutbox = pgTable(
  'event_publication_outbox',
  {
    eventId: uuid('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<EventPublishedFact>().notNull(),
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
      'event_publication_outbox_event_type_valid',
      sql`${table.eventType} = 'event.published.v1'`,
    ),
    check(
      'event_publication_outbox_attempt_count_valid',
      sql`${table.attemptCount} >= 0`,
    ),
    index('event_publication_outbox_pending_idx').on(
      table.publishedAt,
      table.nextAttemptAt,
      table.occurredAt,
    ),
  ],
);
