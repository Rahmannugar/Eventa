import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { eventTicketTypes } from './event-ticket-type.schema';

export type EventCapacityReservationStatus =
  'active' | 'finalized' | 'released' | 'expired';

export const eventCapacityReservations = pgTable(
  'event_capacity_reservations',
  {
    id: uuid('id').primaryKey(),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => eventTicketTypes.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    status: text('status')
      .$type<EventCapacityReservationStatus>()
      .default('active')
      .notNull(),
    expiresAt: timestamp('expires_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    completedAt: timestamp('completed_at', {
      mode: 'date',
      withTimezone: true,
    }),
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
    index('event_capacity_reservations_active_expiry_index')
      .on(table.expiresAt, table.id)
      .where(sql`${table.status} = 'active'`),
    index('event_capacity_reservations_type_active_expiry_index')
      .on(table.ticketTypeId, table.expiresAt, table.id)
      .where(sql`${table.status} = 'active'`),
    check(
      'event_capacity_reservations_quantity_range',
      sql`${table.quantity} BETWEEN 1 AND 1000000`,
    ),
    check(
      'event_capacity_reservations_status_allowed',
      sql`${table.status} IN ('active', 'finalized', 'released', 'expired')`,
    ),
    check(
      'event_capacity_reservations_expiry_after_creation',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'event_capacity_reservations_terminal_shape',
      sql`(${table.status} = 'active' AND ${table.completedAt} IS NULL) OR (${table.status} IN ('finalized', 'released', 'expired') AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);
