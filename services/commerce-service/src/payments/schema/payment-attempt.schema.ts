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

import { commerceOrders } from '../../orders/schema/order.schema';

export const paymentAttemptStatus = pgEnum('payment_attempt_status', [
  'provider_pending',
  'awaiting_confirmation',
]);

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => commerceOrders.id, { onDelete: 'restrict' }),
    attendeeId: uuid('attendee_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: paymentAttemptStatus('status')
      .default('provider_pending')
      .notNull(),
    provider: varchar('provider', { length: 20 }).default('stripe').notNull(),
    providerIdempotencyKey: varchar('provider_idempotency_key', {
      length: 255,
    }).notNull(),
    providerPaymentIntentId: varchar('provider_payment_intent_id', {
      length: 255,
    }),
    providerStatus: varchar('provider_status', { length: 40 }),
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
    uniqueIndex('payment_attempts_order_unique').on(table.orderId),
    uniqueIndex('payment_attempts_provider_idempotency_unique').on(
      table.providerIdempotencyKey,
    ),
    uniqueIndex('payment_attempts_provider_intent_unique')
      .on(table.providerPaymentIntentId)
      .where(sql.raw('provider_payment_intent_id IS NOT NULL')),
    index('payment_attempts_attendee_created_index').on(
      table.attendeeId,
      table.createdAt,
      table.id,
    ),
    check('payment_attempts_amount_positive', sql.raw('amount_minor > 0')),
    check(
      'payment_attempts_currency_shape',
      sql.raw("currency ~ '^[A-Z]{3}$'"),
    ),
    check('payment_attempts_provider_shape', sql.raw("provider = 'stripe'")),
    check(
      'payment_attempts_resolution_shape',
      sql.raw(
        "(status = 'provider_pending' AND provider_payment_intent_id IS NULL AND provider_status IS NULL) OR (status = 'awaiting_confirmation' AND provider_payment_intent_id IS NOT NULL AND provider_status IS NOT NULL)",
      ),
    ),
  ],
);
