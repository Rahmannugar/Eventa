import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { events } from './event.schema';

export const eventTicketCurrencies = pgTable(
  'event_ticket_currencies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    currency: varchar('currency', { length: 3 }).notNull(),
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
    uniqueIndex('event_ticket_currencies_event_currency_unique').on(
      table.eventId,
      table.currency,
    ),
    index('event_ticket_currencies_event_created_index').on(
      table.eventId,
      table.createdAt,
      table.id,
    ),
    check(
      'event_ticket_currencies_currency_format',
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);
