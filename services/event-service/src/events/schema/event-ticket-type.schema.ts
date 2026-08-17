import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { eventTicketCurrencies } from './event-ticket-currency.schema';

export const eventTicketTypes = pgTable(
  'event_ticket_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketCurrencyId: uuid('ticket_currency_id')
      .notNull()
      .references(() => eventTicketCurrencies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    priceMinor: integer('price_minor').notNull(),
    capacity: integer('capacity').notNull(),
    salesStartAt: timestamp('sales_start_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    salesEndAt: timestamp('sales_end_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
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
    uniqueIndex('event_ticket_types_currency_name_unique').on(
      table.ticketCurrencyId,
      sql`lower(${table.name})`,
    ),
    index('event_ticket_types_currency_created_index').on(
      table.ticketCurrencyId,
      table.createdAt,
      table.id,
    ),
    check(
      'event_ticket_types_name_normalized',
      sql`${table.name} = btrim(${table.name}) AND ${table.name} !~ '\\s{2,}'`,
    ),
    check(
      'event_ticket_types_name_length',
      sql`char_length(${table.name}) BETWEEN 1 AND 80`,
    ),
    check(
      'event_ticket_types_description_shape',
      sql`${table.description} IS NULL OR (${table.description} = btrim(${table.description}) AND char_length(${table.description}) BETWEEN 1 AND 500)`,
    ),
    check(
      'event_ticket_types_price_range',
      sql`${table.priceMinor} BETWEEN 0 AND 2147483647`,
    ),
    check(
      'event_ticket_types_capacity_range',
      sql`${table.capacity} BETWEEN 1 AND 1000000`,
    ),
    check(
      'event_ticket_types_sales_window_valid',
      sql`${table.salesEndAt} > ${table.salesStartAt}`,
    ),
  ],
);
