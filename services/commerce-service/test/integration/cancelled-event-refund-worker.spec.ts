import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CancelledEventRefundRepository } from '../../src/cancelled-event-refunds/repositories/cancelled-event-refund.repository';
import { EventCancellationRefundService } from '../../src/cancelled-event-refunds/services/event-cancellation-refund.service';
import { CancelledEventRefundWorker } from '../../src/cancelled-event-refunds/services/cancelled-event-refund.worker';
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
import type {
  PaymentProviderPort,
  ProviderPaymentIntent,
  ProviderRefund,
} from '../../src/payments/types/payment-provider.port';

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
const cancellation = new EventCancellationRefundService(repository);

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

async function createPaidOrder(
  eventId: string,
): Promise<{ orderId: string; paymentId: string; paymentIntentId: string }> {
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
  await payments.applyReconciliation({
    intent: providerIntent({ orderId, paymentId, paymentIntentId }),
    now: new Date(),
    paymentId,
    reconcileAfter: null,
    status: 'succeeded',
  });
  await orders.markPaid(orderId);
  return { orderId, paymentId, paymentIntentId };
}

function refundResponse(input: {
  paymentIntentId: string;
  status?: string;
}): ProviderRefund {
  return {
    amountMinor: 5_000,
    currency: 'NGN',
    paymentIntentId: input.paymentIntentId,
    refundId: `re_${randomUUID().replaceAll('-', '')}`,
    status: input.status ?? 'succeeded',
  };
}

function providerWith(create: PaymentProviderPort['createRefund']) {
  return { createRefund: create } as unknown as PaymentProviderPort;
}

async function claimFor(
  orderId: string,
): Promise<
  | { failures: number; processedAt: Date | null; claimedUntil: Date | null }
  | undefined
> {
  const [row] = await database
    .select({
      claimedUntil: paymentWorkflowOutcomes.claimedUntil,
      failures: paymentWorkflowOutcomes.failures,
      processedAt: paymentWorkflowOutcomes.processedAt,
    })
    .from(paymentWorkflowOutcomes)
    .where(
      and(
        eq(paymentWorkflowOutcomes.orderId, orderId),
        eq(paymentWorkflowOutcomes.kind, 'event_cancelled'),
      ),
    )
    .limit(1);
  return row;
}

async function orderStatus(orderId: string): Promise<string | undefined> {
  const [row] = await database
    .select({ status: commerceOrders.status })
    .from(commerceOrders)
    .where(eq(commerceOrders.id, orderId))
    .limit(1);
  return row?.status;
}

function refundedFacts() {
  return database
    .select()
    .from(commerceOrderOutbox)
    .where(eq(commerceOrderOutbox.eventType, 'commerce.order-refunded.v1'));
}

describe('Cancelled event refund execution', () => {
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

  it('refunds a claimed order once and appends one refunded fact', async () => {
    const eventId = randomUUID();
    const order = await createPaidOrder(eventId);
    await cancellation.handleCancellation({
      cancelledAt: new Date().toISOString(),
      eventId,
      messageId: randomUUID(),
      type: 'event.cancelled.v1',
    });
    const worker = new CancelledEventRefundWorker(
      payments,
      orders,
      providerWith((input) =>
        Promise.resolve(
          refundResponse({ paymentIntentId: input.paymentIntentId }),
        ),
      ),
    );

    await expect(worker.process()).resolves.toBe(1);

    await expect(orderStatus(order.orderId)).resolves.toBe('refunded');
    await expect(
      claimFor(order.orderId).then((claim) => claim?.processedAt),
    ).resolves.toBeInstanceOf(Date);
    const [refund] = await database
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.orderId, order.orderId));
    expect(refund?.status).toBe('succeeded');
    expect(refund?.amountMinor).toBe(5_000);

    const facts = await refundedFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]?.aggregateId).toBe(order.orderId);
    expect(facts[0]?.aggregateType).toBe('eventa.commerce.order.v1');
    expect(facts[0]?.payload).toMatchObject({
      currency: 'NGN',
      eventId,
      messageId: facts[0]?.eventId,
      orderId: order.orderId,
      quantity: 2,
      totalMinor: 5_000,
      type: 'commerce.order-refunded.v1',
    });
    expect((facts[0]?.payload as { refundedAt?: string }).refundedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    await expect(worker.process()).resolves.toBe(0);
    await expect(refundedFacts()).resolves.toHaveLength(1);
  });

  it('completes a claim on an already refunded order without a second fact', async () => {
    const eventId = randomUUID();
    const order = await createPaidOrder(eventId);
    await cancellation.handleCancellation({
      cancelledAt: new Date().toISOString(),
      eventId,
      messageId: randomUUID(),
      type: 'event.cancelled.v1',
    });
    await orders.markRefunded(order.orderId);
    const worker = new CancelledEventRefundWorker(
      payments,
      orders,
      providerWith(() =>
        Promise.reject(new Error('PROVIDER_MUST_NOT_BE_CALLED')),
      ),
    );

    await expect(worker.process()).resolves.toBe(1);

    await expect(
      claimFor(order.orderId).then((claim) => claim?.processedAt),
    ).resolves.toBeInstanceOf(Date);
    await expect(refundedFacts()).resolves.toHaveLength(1);
    await expect(worker.process()).resolves.toBe(0);
    await expect(refundedFacts()).resolves.toHaveLength(1);
  });

  it('stops the claim when the provider declares the refund failed', async () => {
    const eventId = randomUUID();
    const order = await createPaidOrder(eventId);
    await cancellation.handleCancellation({
      cancelledAt: new Date().toISOString(),
      eventId,
      messageId: randomUUID(),
      type: 'event.cancelled.v1',
    });
    const worker = new CancelledEventRefundWorker(
      payments,
      orders,
      providerWith((input) =>
        Promise.resolve(
          refundResponse({
            paymentIntentId: input.paymentIntentId,
            status: 'failed',
          }),
        ),
      ),
    );

    await expect(worker.process()).resolves.toBe(1);

    await expect(orderStatus(order.orderId)).resolves.toBe('refunding');
    await expect(
      claimFor(order.orderId).then((claim) => claim?.processedAt),
    ).resolves.toBeInstanceOf(Date);
    const [refund] = await database
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.orderId, order.orderId));
    expect(refund?.status).toBe('failed');
    await expect(refundedFacts()).resolves.toHaveLength(0);
  });

  it('schedules a retry when the provider is unavailable', async () => {
    const eventId = randomUUID();
    const order = await createPaidOrder(eventId);
    await cancellation.handleCancellation({
      cancelledAt: new Date().toISOString(),
      eventId,
      messageId: randomUUID(),
      type: 'event.cancelled.v1',
    });
    const worker = new CancelledEventRefundWorker(
      payments,
      orders,
      providerWith(() => Promise.reject(new Error('PROVIDER_UNAVAILABLE'))),
    );

    await expect(worker.process()).resolves.toBe(1);

    await expect(orderStatus(order.orderId)).resolves.toBe('refunding');
    const claim = await claimFor(order.orderId);
    expect(claim?.processedAt).toBeNull();
    expect(claim?.failures).toBe(1);
    expect(claim?.claimedUntil).toBeNull();
    await expect(refundedFacts()).resolves.toHaveLength(0);
  });

  it('does not lease sibling workflow outcomes of another kind', async () => {
    const eventId = randomUUID();
    const order = await createPaidOrder(eventId);
    await cancellation.handleCancellation({
      cancelledAt: new Date().toISOString(),
      eventId,
      messageId: randomUUID(),
      type: 'event.cancelled.v1',
    });

    const claimed = await payments.claimWorkflowOutcomes({
      claimedUntil: new Date(Date.now() + 120_000),
      kinds: ['event_cancelled'],
      limit: 25,
      now: new Date(),
    });

    expect(claimed.map((row) => row.kind)).toEqual(['event_cancelled']);
    const [sibling] = await database
      .select({ claimedUntil: paymentWorkflowOutcomes.claimedUntil })
      .from(paymentWorkflowOutcomes)
      .where(
        and(
          eq(paymentWorkflowOutcomes.orderId, order.orderId),
          eq(paymentWorkflowOutcomes.kind, 'payment_succeeded'),
        ),
      )
      .limit(1);
    expect(sibling?.claimedUntil).toBeNull();
  });
});
