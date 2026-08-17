import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { eventTicketConfigurations } from './event-ticket-configuration.schema';

export const eventTicketTypes = pgTable(
  'event_ticket_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    priceMinor: integer('price_minor').notNull(),
    allocation: integer('allocation').notNull(),
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
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [eventTicketConfigurations.eventId],
      name: 'event_ticket_types_configuration_fk',
    }).onDelete('restrict'),
    uniqueIndex('event_ticket_types_event_name_unique').on(
      table.eventId,
      sql`lower(${table.name})`,
    ),
    index('event_ticket_types_event_created_index').on(
      table.eventId,
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
      'event_ticket_types_allocation_range',
      sql`${table.allocation} BETWEEN 1 AND 1000000`,
    ),
    check(
      'event_ticket_types_sales_window_valid',
      sql`${table.salesEndAt} > ${table.salesStartAt}`,
    ),
  ],
);
