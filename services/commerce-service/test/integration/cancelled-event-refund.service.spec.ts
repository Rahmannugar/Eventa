import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CancelledEventRefundRepository } from '../../src/cancelled-event-refunds/repositories/cancelled-event-refund.repository';
import { EventCancellationRefundService } from '../../src/cancelled-event-refunds/services/event-cancellation-refund.service';
import { commerceEventCancellationInbox } from '../../src/cancelled-event-refunds/schema/event-cancellation-inbox.schema';
import { OrderRepository } from '../../src/orders/repositories/order.repository';
import {
  commerceOrderItems,
  commerceOrders,
} from '../../src/orders/schema/order.schema';
import { commerceOrderOutbox } from '../../src/orders/schema/order-outbox.schema';
import { PaymentAttemptRepository } from '../../src/payments/repositories/payment-attempt.repository';
import {
  paymentAttempts,
  paymentProviderEvents,
  paymentRefunds,
  paymentWorkflowOutcomes,
} from '../../src/payments/schema/payment-attempt.schema';
import type { ProviderPaymentIntent } from '../../src/payments/types/payment-provider.port';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === '') {
  throw new Error('TEST_DATABASE_URL is required for integration tests');
}
const requiredTestDatabaseUrl = testDatabaseUrl;
const testDatabaseName = new URL(requiredTestDatabaseUrl).pathname.slice(1);
if (!/^[a-z][a-z0-9_]*_test$/.test(testDatabaseName)) {
  throw new Error('TEST_DATABASE_URL must target a database ending in _test');
}

async function ensureTestDatabase(): Promise<void> {
  const adminUrl = new URL(requiredTestDatabaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const [state] = await admin<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_database WHERE datname = ${testDatabaseName}
      ) AS exists
    `;
    if (state?.exists !== true) {
      await admin.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    }
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      Reflect.get(error, 'code') !== '42P04'
    ) {
      throw error;
    }
  } finally {
    await admin.end();
  }
}

const client = postgres(requiredTestDatabaseUrl, {
  max: 10,
  onnotice: () => undefined,
});
const database = drizzle(client);
const orders = new OrderRepository(database);
const payments = new PaymentAttemptRepository(database);
const repository = new CancelledEventRefundRepository(database);
const refunds = new EventCancellationRefundService(repository);

async function cleanDatabase(): Promise<void> {
  await database.delete(commerceEventCancellationInbox);
  await database.delete(paymentProviderEvents);
  await database.delete(paymentRefunds);
  await database.delete(paymentWorkflowOutcomes);
  await database.delete(paymentAttempts);
  await database.delete(commerceOrderItems);
  await database.delete(commerceOrderOutbox);
  await database.delete(commerceOrders);
}

function providerIntent(input: {
  orderId: string;
  paymentId: string;
  paymentIntentId: string;
}): ProviderPaymentIntent {
  return {
    amountMinor: 5_000,
    clientSecret: null,
    currency: 'NGN',
    hasLastPaymentError: false,
    metadata: {
      eventa_order_id: input.orderId,
      eventa_payment_id: input.paymentId,
    },
    paymentIntentId: input.paymentIntentId,
    status: 'succeeded',
  };
}

async function createOrder(
  eventId: string,
  status: 'pending_payment' | 'paid' | 'expired' | 'failed',
): Promise<{ orderId: string; paymentId: string }> {
  const orderId = randomUUID();
  await orders.createPending({
    attendeeId: randomUUID(),
    eventId,
    idempotencyKey: randomUUID(),
    orderId,
    quantity: 2,
    ticketTypeId: randomUUID(),
  });
  const reserved = await orders.markReserved({
    currency: 'NGN',
    orderId,
    quantity: 2,
    reservationExpiresAt: new Date(Date.now() + 600_000),
    ticketName: 'Standard',
    totalMinor: 5_000,
    unitPriceMinor: 2_500,
  });
  const paymentId = randomUUID();
  const paymentIntentId = `pi_${paymentId.replaceAll('-', '')}`;
  await payments.createPending({
    amountMinor: 5_000,
    attendeeId: reserved.attendeeId,
    currency: 'NGN',
    orderId: reserved.orderId,
    paymentId,
    providerIdempotencyKey: `eventa-payment:${paymentId}`,
    reconcileAfter: new Date(),
  });
  await payments.markAwaitingConfirmation({
    paymentId,
    providerPaymentIntentId: paymentIntentId,
    providerStatus: 'requires_payment_method',
  });
  if (status === 'pending_payment') return { orderId, paymentId };
  if (status === 'expired') {
    await orders.markExpired(orderId);
    return { orderId, paymentId };
  }
  if (status === 'failed') {
    await orders.markFailed({ failureCode: 'PAYMENT_CANCELED', orderId });
    return { orderId, paymentId };
  }
  await payments.applyReconciliation({
    intent: providerIntent({ orderId, paymentId, paymentIntentId }),
    now: new Date(),
    paymentId,
    reconcileAfter: null,
    status: 'succeeded',
  });
  await orders.markPaid(orderId);
  return { orderId, paymentId };
}

function cancellationFact(eventId: string) {
  return {
    cancelledAt: new Date().toISOString(),
    eventId,
    messageId: randomUUID(),
    type: 'event.cancelled.v1' as const,
  };
}

async function orderStatus(orderId: string): Promise<string | undefined> {
  const [row] = await database
    .select({ status: commerceOrders.status })
    .from(commerceOrders)
    .where(eq(commerceOrders.id, orderId))
    .limit(1);
  return row?.status;
}

async function claimKinds(orderId: string): Promise<string[]> {
  const rows = await database
    .select({ kind: paymentWorkflowOutcomes.kind })
    .from(paymentWorkflowOutcomes)
    .where(eq(paymentWorkflowOutcomes.orderId, orderId));
  return rows.map((row) => row.kind).sort();
}

describe('Cancelled event refund integration', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(cleanDatabase);

  afterAll(async () => {
    await cleanDatabase();
    await client.end();
  });

  it('claims paid orders for a cancelled event exactly once', async () => {
    const eventId = randomUUID();
    const { orderId } = await createOrder(eventId, 'paid');
    const fact = cancellationFact(eventId);

    await expect(refunds.handleCancellation(fact)).resolves.toBe('processed');
    await expect(orderStatus(orderId)).resolves.toBe('refunding');
    await expect(claimKinds(orderId)).resolves.toEqual([
      'event_cancelled',
      'payment_succeeded',
    ]);

    const [inbox] = await database
      .select()
      .from(commerceEventCancellationInbox)
      .where(eq(commerceEventCancellationInbox.messageId, fact.messageId));
    expect(inbox?.status).toBe('processed');
    expect(inbox?.processedAt).toBeInstanceOf(Date);

    await expect(refunds.handleCancellation(fact)).resolves.toBe('duplicate');
    await expect(orderStatus(orderId)).resolves.toBe('refunding');
    await expect(claimKinds(orderId)).resolves.toEqual([
      'event_cancelled',
      'payment_succeeded',
    ]);
  });

  it('claims every paid order of the cancelled event', async () => {
    const eventId = randomUUID();
    const first = await createOrder(eventId, 'paid');
    const second = await createOrder(eventId, 'paid');

    await refunds.handleCancellation(cancellationFact(eventId));

    await expect(orderStatus(first.orderId)).resolves.toBe('refunding');
    await expect(orderStatus(second.orderId)).resolves.toBe('refunding');
    await expect(claimKinds(first.orderId)).resolves.toContain(
      'event_cancelled',
    );
    await expect(claimKinds(second.orderId)).resolves.toContain(
      'event_cancelled',
    );
  });

  it('leaves orders that cannot be refunded untouched', async () => {
    const eventId = randomUUID();
    const pending = await createOrder(eventId, 'pending_payment');
    const expired = await createOrder(eventId, 'expired');
    const failed = await createOrder(eventId, 'failed');
    const otherEvent = await createOrder(randomUUID(), 'paid');

    await refunds.handleCancellation(cancellationFact(eventId));

    await expect(orderStatus(pending.orderId)).resolves.toBe('pending_payment');
    await expect(orderStatus(expired.orderId)).resolves.toBe('expired');
    await expect(orderStatus(failed.orderId)).resolves.toBe('failed');
    await expect(claimKinds(pending.orderId)).resolves.toEqual([]);
    await expect(claimKinds(failed.orderId)).resolves.toEqual([]);
    await expect(orderStatus(otherEvent.orderId)).resolves.toBe('paid');
    await expect(claimKinds(otherEvent.orderId)).resolves.toEqual([
      'payment_succeeded',
    ]);
  });

  it('claims an order that becomes paid after the cancellation was processed', async () => {
    const eventId = randomUUID();
    await refunds.handleCancellation(cancellationFact(eventId));
    const { orderId } = await createOrder(eventId, 'paid');

    await expect(
      refunds.ensureOrderClaimed({ eventId, orderId }),
    ).resolves.toBe('claimed');
    await expect(orderStatus(orderId)).resolves.toBe('refunding');
    await expect(claimKinds(orderId)).resolves.toContain('event_cancelled');
  });

  it('leaves a paid order alone until its event cancellation is recorded', async () => {
    const eventId = randomUUID();
    const { orderId } = await createOrder(eventId, 'paid');

    await expect(
      refunds.ensureOrderClaimed({ eventId, orderId }),
    ).resolves.toBe('not_cancelled');
    await expect(orderStatus(orderId)).resolves.toBe('paid');
    await expect(claimKinds(orderId)).resolves.toEqual(['payment_succeeded']);
  });

  it('does not claim an order that is not paid yet', async () => {
    const eventId = randomUUID();
    const { orderId } = await createOrder(eventId, 'pending_payment');
    const fact = cancellationFact(eventId);
    await refunds.handleCancellation(fact);

    await expect(
      refunds.ensureOrderClaimed({ eventId, orderId }),
    ).resolves.toBe('not_eligible');
    await expect(orderStatus(orderId)).resolves.toBe('pending_payment');
    await expect(claimKinds(orderId)).resolves.toEqual([]);
  });

  it('stays idempotent when a second message arrives for the same event', async () => {
    const eventId = randomUUID();
    const { orderId } = await createOrder(eventId, 'paid');
    await refunds.handleCancellation(cancellationFact(eventId));

    const replay = {
      ...cancellationFact(eventId),
      messageId: randomUUID(),
    };
    await expect(refunds.handleCancellation(replay)).resolves.toBe('processed');
    await expect(orderStatus(orderId)).resolves.toBe('refunding');
    await expect(claimKinds(orderId)).resolves.toEqual([
      'event_cancelled',
      'payment_succeeded',
    ]);
  });
});
