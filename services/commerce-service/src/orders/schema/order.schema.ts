import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const commerceOrderStatus = pgEnum('commerce_order_status', [
  'pending_reservation',
  'pending_payment',
  'paid',
  'failed',
  'expired',
  'refunding',
  'refunded',
]);

export const commerceOrders = pgTable(
  'commerce_orders',
  {
    id: uuid('id').primaryKey(),
    attendeeId: uuid('attendee_id').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    eventId: uuid('event_id').notNull(),
    ticketTypeId: uuid('ticket_type_id').notNull(),
    requestedQuantity: integer('requested_quantity').notNull(),
    status: commerceOrderStatus('status')
      .default('pending_reservation')
      .notNull(),
    currency: varchar('currency', { length: 3 }),
    totalMinor: integer('total_minor'),
    reservationExpiresAt: timestamp('reservation_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    failureCode: varchar('failure_code', { length: 80 }),
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
    uniqueIndex('commerce_orders_attendee_idempotency_unique').on(
      table.attendeeId,
      table.idempotencyKey,
    ),
    index('commerce_orders_attendee_created_index').on(
      table.attendeeId,
      table.createdAt,
      table.id,
    ),
    index('commerce_orders_pending_reservation_index')
      .on(table.updatedAt, table.id)
      .where(sql.raw("status = 'pending_reservation'")),
    check(
      'commerce_orders_requested_quantity_range',
      sql.raw('requested_quantity BETWEEN 1 AND 1000000'),
    ),
    check(
      'commerce_orders_quote_shape',
      sql.raw(
        "(status = 'pending_reservation' AND currency IS NULL AND total_minor IS NULL AND reservation_expires_at IS NULL) OR (status <> 'pending_reservation' AND currency ~ '^[A-Z]{3}$' AND total_minor >= 0 AND reservation_expires_at IS NOT NULL)",
      ),
    ),
    check(
      'commerce_orders_failure_shape',
      sql.raw(
        "(status = 'failed' AND failure_code IS NOT NULL) OR (status <> 'failed' AND failure_code IS NULL)",
      ),
    ),
  ],
);

export const commerceOrderItems = pgTable(
  'commerce_order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => commerceOrders.id, { onDelete: 'cascade' }),
    ticketName: varchar('ticket_name', { length: 80 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    lineTotalMinor: integer('line_total_minor').notNull(),
  },
  (table) => [
    uniqueIndex('commerce_order_items_one_per_order').on(table.orderId),
    check(
      'commerce_order_items_quantity_range',
      sql.raw('quantity BETWEEN 1 AND 1000000'),
    ),
    check(
      'commerce_order_items_money_shape',
      sql.raw(
        'unit_price_minor >= 0 AND line_total_minor >= 0 AND line_total_minor = unit_price_minor * quantity',
      ),
    ),
  ],
);
