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

import { eventTicketTypes } from './event-ticket-type.schema';
import { eventCapacityReservations } from './event-capacity-reservation.schema';

export type EventWaitlistEntryStatus =
  'waiting' | 'eligible' | 'left' | 'closed' | 'expired' | 'reserved';

export const eventWaitlistEntries = pgTable(
  'event_waitlist_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketTypeId: uuid('ticket_type_id')
      .notNull()
      .references(() => eventTicketTypes.id, { onDelete: 'restrict' }),
    attendeeId: uuid('attendee_id').notNull(),
    quantity: integer('quantity').notNull(),
    status: text('status')
      .$type<EventWaitlistEntryStatus>()
      .default('waiting')
      .notNull(),
    eligibleAt: timestamp('eligible_at', {
      mode: 'date',
      withTimezone: true,
    }),
    opportunityExpiresAt: timestamp('opportunity_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    reservationId: uuid('reservation_id').references(
      () => eventCapacityReservations.id,
      { onDelete: 'restrict' },
    ),
    leftAt: timestamp('left_at', { mode: 'date', withTimezone: true }),
    closedAt: timestamp('closed_at', { mode: 'date', withTimezone: true }),
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
    uniqueIndex('event_waitlist_entries_active_attendee_unique')
      .on(table.ticketTypeId, table.attendeeId)
      .where(sql`${table.status} IN ('waiting', 'eligible')`),
    index('event_waitlist_entries_waiting_order_index')
      .on(table.ticketTypeId, table.createdAt, table.id)
      .where(sql`${table.status} = 'waiting'`),
    index('event_waitlist_entries_eligible_expiry_index')
      .on(table.ticketTypeId, table.opportunityExpiresAt, table.id)
      .where(sql`${table.status} = 'eligible'`),
    check(
      'event_waitlist_entries_quantity_range',
      sql`${table.quantity} BETWEEN 1 AND 1000000`,
    ),
    check(
      'event_waitlist_entries_status_allowed',
      sql`${table.status} IN ('waiting', 'eligible', 'left', 'closed', 'expired', 'reserved')`,
    ),
    check(
      'event_waitlist_entries_lifecycle_shape',
      sql`(${table.status} = 'waiting' AND ${table.eligibleAt} IS NULL AND ${table.opportunityExpiresAt} IS NULL AND ${table.reservationId} IS NULL AND ${table.leftAt} IS NULL AND ${table.closedAt} IS NULL) OR (${table.status} = 'eligible' AND ${table.eligibleAt} IS NOT NULL AND ${table.opportunityExpiresAt} > ${table.eligibleAt} AND ${table.reservationId} IS NULL AND ${table.leftAt} IS NULL AND ${table.closedAt} IS NULL) OR (${table.status} = 'reserved' AND ${table.eligibleAt} IS NOT NULL AND ${table.opportunityExpiresAt} IS NOT NULL AND ${table.reservationId} IS NOT NULL AND ${table.leftAt} IS NULL AND ${table.closedAt} IS NULL) OR (${table.status} = 'expired' AND ${table.eligibleAt} IS NOT NULL AND ${table.opportunityExpiresAt} IS NOT NULL AND ${table.reservationId} IS NULL AND ${table.leftAt} IS NULL AND ${table.closedAt} IS NOT NULL) OR (${table.status} = 'left' AND ${table.reservationId} IS NULL AND ${table.leftAt} IS NOT NULL AND ${table.closedAt} IS NULL) OR (${table.status} = 'closed' AND ${table.reservationId} IS NULL AND ${table.leftAt} IS NULL AND ${table.closedAt} IS NOT NULL)`,
    ),
  ],
);
