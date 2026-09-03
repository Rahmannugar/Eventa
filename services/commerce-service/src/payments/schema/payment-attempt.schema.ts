import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { commerceOrders } from '../../orders/schema/order.schema';
import type {
  PaymentAttemptStatus,
  PaymentWorkflowOutcomeKind,
} from '../types/payment-attempt.types';

export const providerEventStatus = pgEnum('provider_event_status', [
  'received',
  'processed',
  'ignored',
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
    status: varchar('status', { length: 32 })
      .$type<PaymentAttemptStatus>()
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
    lastProviderEventId: varchar('last_provider_event_id', { length: 255 }),
    lastProviderEventCreatedAt: timestamp('last_provider_event_created_at', {
      mode: 'date',
      withTimezone: true,
    }),
    reconcileAfter: timestamp('reconcile_after', {
      mode: 'date',
      withTimezone: true,
    }),
    reconciliationClaimedUntil: timestamp('reconciliation_claimed_until', {
      mode: 'date',
      withTimezone: true,
    }),
    reconciliationFailures: integer('reconciliation_failures')
      .default(0)
      .notNull(),
    lastReconciledAt: timestamp('last_reconciled_at', {
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
    index('payment_attempts_reconciliation_index')
      .on(table.reconcileAfter, table.id)
      .where(sql.raw("status NOT IN ('succeeded', 'canceled')")),
    check('payment_attempts_amount_positive', sql.raw('amount_minor > 0')),
    check(
      'payment_attempts_currency_shape',
      sql.raw("currency ~ '^[A-Z]{3}$'"),
    ),
    check('payment_attempts_provider_shape', sql.raw("provider = 'stripe'")),
    check(
      'payment_attempts_status_shape',
      sql.raw(
        "status IN ('provider_pending', 'awaiting_confirmation', 'requires_action', 'processing', 'failed', 'succeeded', 'canceled')",
      ),
    ),
    check(
      'payment_attempts_reconciliation_failures_nonnegative',
      sql.raw('reconciliation_failures >= 0'),
    ),
    check(
      'payment_attempts_resolution_shape',
      sql.raw(
        "(status = 'provider_pending' AND provider_payment_intent_id IS NULL AND provider_status IS NULL AND reconcile_after IS NOT NULL) OR (status IN ('succeeded', 'canceled') AND provider_payment_intent_id IS NOT NULL AND provider_status IS NOT NULL AND reconcile_after IS NULL) OR (status NOT IN ('provider_pending', 'succeeded', 'canceled') AND provider_payment_intent_id IS NOT NULL AND provider_status IS NOT NULL AND reconcile_after IS NOT NULL)",
      ),
    ),
  ],
);

export const paymentWorkflowOutcomes = pgTable(
  'payment_workflow_outcomes',
  {
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 32 })
      .$type<PaymentWorkflowOutcomeKind>()
      .notNull(),
    orderId: uuid('order_id').notNull(),
    availableAt: timestamp('available_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    claimedUntil: timestamp('claimed_until', { mode: 'date', withTimezone: true }),
    failures: integer('failures').default(0).notNull(),
    processedAt: timestamp('processed_at', { mode: 'date', withTimezone: true }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.kind] }),
    index('payment_workflow_outcomes_claim_index')
      .on(table.availableAt, table.paymentId, table.kind)
      .where(sql.raw('processed_at IS NULL')),
    check(
      'payment_workflow_outcomes_kind_shape',
      sql.raw("kind IN ('payment_succeeded', 'payment_canceled')"),
    ),
    check('payment_workflow_outcomes_failures_nonnegative', sql.raw('failures >= 0')),
  ],
);

export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: uuid('id').primaryKey(),
    paymentId: uuid('payment_id').notNull().references(() => paymentAttempts.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    providerIdempotencyKey: varchar('provider_idempotency_key', { length: 255 }).notNull(),
    providerRefundId: varchar('provider_refund_id', { length: 255 }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('payment_refunds_payment_unique').on(table.paymentId),
    uniqueIndex('payment_refunds_order_unique').on(table.orderId),
    uniqueIndex('payment_refunds_provider_key_unique').on(table.providerIdempotencyKey),
    check('payment_refunds_amount_positive', sql.raw('amount_minor > 0')),
    check('payment_refunds_status_shape', sql.raw("status IN ('pending', 'succeeded', 'failed')")),
  ],
);

export const paymentProviderEvents = pgTable(
  'payment_provider_events',
  {
    provider: varchar('provider', { length: 20 }).default('stripe').notNull(),
    providerEventId: varchar('provider_event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    providerObjectId: varchar('provider_object_id', { length: 255 }).notNull(),
    paymentId: uuid('payment_id').references(() => paymentAttempts.id, {
      onDelete: 'cascade',
    }),
    status: providerEventStatus('status').default('received').notNull(),
    providerCreatedAt: timestamp('provider_created_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    receivedAt: timestamp('received_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    processedAt: timestamp('processed_at', {
      mode: 'date',
      withTimezone: true,
    }),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerEventId],
      name: 'payment_provider_events_primary',
    }),
    index('payment_provider_events_payment_index').on(
      table.paymentId,
      table.providerCreatedAt,
    ),
    check(
      'payment_provider_events_provider_shape',
      sql.raw("provider = 'stripe'"),
    ),
    check(
      'payment_provider_events_status_shape',
      sql.raw(
        "(status = 'received' AND processed_at IS NULL) OR (status IN ('processed', 'ignored') AND processed_at IS NOT NULL)",
      ),
    ),
  ],
);
