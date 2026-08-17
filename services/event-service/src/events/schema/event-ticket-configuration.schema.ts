import { sql } from 'drizzle-orm';
import { check, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { events } from './event.schema';

export const eventTicketConfigurations = pgTable(
  'event_ticket_configurations',
  {
    eventId: uuid('event_id')
      .primaryKey()
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
    check(
      'event_ticket_configurations_currency_format',
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);
