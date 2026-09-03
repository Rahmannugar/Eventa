import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OrderRepository } from '../../src/orders/repositories/order.repository';
import {
  commerceOrderItems,
  commerceOrders,
} from '../../src/orders/schema/order.schema';
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
import { TicketPurchaseCompletionService } from '../../src/ticket-purchase/services/ticket-purchase-completion.service';
import { TicketPurchaseExpiryService } from '../../src/ticket-purchase/services/ticket-purchase-expiry.service';
import type {
  EventCapacityPort,
  EventCapacityQuote,
  EventCapacityTransitionCommand,
  EventCapacityTransitionResult,
} from '../../src/ticket-purchase/types/event-capacity.port';

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

class RecordingCapacity implements EventCapacityPort {
  readonly finalized: string[] = [];
  readonly released: string[] = [];

  constructor(
    private readonly finalizeStatus: EventCapacityTransitionResult<
      'finalized' | 'expired'
    >['status'] =
      'finalized',
  ) {}

  reserve(): Promise<EventCapacityQuote> {
    return Promise.reject(new Error('Unexpected reserve'));
  }

  finalize(
    input: EventCapacityTransitionCommand,
  ): Promise<EventCapacityTransitionResult<'finalized' | 'expired'>> {
    this.finalized.push(input.reservationId);
    return Promise.resolve({
      ...input,
      quantity: 2,
      status: this.finalizeStatus,
    });
  }

  release(
    input: EventCapacityTransitionCommand,
  ): Promise<EventCapacityTransitionResult<'released' | 'expired'>> {
    this.released.push(input.reservationId);
    return Promise.resolve({ ...input, quantity: 2, status: 'released' });
  }
}

class RecordingProvider implements PaymentProviderPort {
  readonly cancellations: string[] = [];
  readonly intents = new Map<string, ProviderPaymentIntent>();
  readonly refundKeys: string[] = [];
  readonly refunds = new Map<string, ProviderRefund>();

  constructor(
    private loseFirstRefundResponse = false,
    private readonly refundStatus = 'succeeded',
  ) {}

  createIntent(): Promise<ProviderPaymentIntent> {
    return Promise.reject(new Error('Unexpected payment creation'));
  }

  retrieveIntent(paymentIntentId: string): Promise<ProviderPaymentIntent> {
    const intent = this.intents.get(paymentIntentId);
    if (intent === undefined) {
      return Promise.reject(new Error('Provider payment missing'));
    }
    return Promise.resolve(intent);
  }

  cancelIntent(paymentIntentId: string): Promise<ProviderPaymentIntent> {
    this.cancellations.push(paymentIntentId);
    const intent = this.intents.get(paymentIntentId);
    if (intent === undefined) {
      return Promise.reject(new Error('Provider payment missing'));
    }
    intent.status = 'canceled';
    return Promise.resolve(intent);
  }

  createRefund(input: {
    paymentIntentId: string;
    idempotencyKey: string;
  }): Promise<ProviderRefund> {
    this.refundKeys.push(input.idempotencyKey);
    const existing = this.refunds.get(input.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    const created = {
      amountMinor: 5_000,
      currency: 'NGN',
      paymentIntentId: input.paymentIntentId,
      refundId: `re_${randomUUID()}`,
      status: this.refundStatus,
    };
    this.refunds.set(input.idempotencyKey, created);
    if (this.loseFirstRefundResponse) {
      this.loseFirstRefundResponse = false;
      return Promise.reject(new Error('PAYMENT_PROVIDER_UNAVAILABLE'));
    }
    return Promise.resolve(created);
  }

  retrieveRefund(refundId: string): Promise<ProviderRefund> {
    const refund = [...this.refunds.values()].find(
      (candidate) => candidate.refundId === refundId,
    );
    if (refund === undefined) {
      return Promise.reject(new Error('Provider refund missing'));
    }
    return Promise.resolve(refund);
  }
}

const client = postgres(requiredTestDatabaseUrl, {
  max: 10,
  onnotice: () => undefined,
});
const database = drizzle(client);
const orders = new OrderRepository(database);
const payments = new PaymentAttemptRepository(database);

async function cleanDatabase(): Promise<void> {
  await database.delete(paymentProviderEvents);
  await database.delete(paymentRefunds);
  await database.delete(paymentWorkflowOutcomes);
  await database.delete(paymentAttempts);
  await database.delete(commerceOrderItems);
  await database.delete(commerceOrders);
}

async function createCheckout(expiresAt: Date) {
  const order = await orders.createPending({
    attendeeId: randomUUID(),
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    orderId: randomUUID(),
    quantity: 2,
    ticketTypeId: randomUUID(),
  });
  const reserved = await orders.markReserved({
    currency: 'NGN',
    orderId: order.orderId,
    quantity: 2,
    reservationExpiresAt: expiresAt,
    ticketName: 'Standard',
    totalMinor: 5_000,
    unitPriceMinor: 2_500,
  });
  const paymentId = randomUUID();
  await payments.createPending({
    amountMinor: 5_000,
    attendeeId: reserved.attendeeId,
    currency: 'NGN',
    orderId: reserved.orderId,
    paymentId,
    providerIdempotencyKey: `eventa-payment:${paymentId}`,
    reconcileAfter: new Date(),
  });
  const paymentIntentId = `pi_${paymentId.replaceAll('-', '')}`;
  await payments.markAwaitingConfirmation({
    paymentId,
    providerPaymentIntentId: paymentIntentId,
    providerStatus: 'requires_payment_method',
  });
  return { order: reserved, paymentId, paymentIntentId };
}

function providerIntent(input: {
  orderId: string;
  paymentId: string;
  paymentIntentId: string;
  status: string;
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
    status: input.status,
  };
}

describe('Ticket purchase workflow integration', () => {
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

  it('leases successful completion across workers', async () => {
    const checkout = await createCheckout(new Date(Date.now() + 600_000));
    await payments.applyReconciliation({
      intent: providerIntent({ ...checkout, orderId: checkout.order.orderId, status: 'succeeded' }),
      now: new Date(),
      paymentId: checkout.paymentId,
      reconcileAfter: null,
      status: 'succeeded',
    });
    const capacity = new RecordingCapacity();
    const provider = new RecordingProvider();
    const workers = [
      new TicketPurchaseCompletionService(payments, orders, capacity, provider),
      new TicketPurchaseCompletionService(payments, orders, capacity, provider),
    ];

    const claimed = await Promise.all(workers.map((worker) => worker.process()));

    expect(claimed.reduce((total, value) => total + value, 0)).toBe(1);
    expect(capacity.finalized).toEqual([checkout.order.orderId]);
    await expect(orders.findById(checkout.order.orderId)).resolves.toMatchObject({
      status: 'paid',
    });
    const [outcome] = await database.select().from(paymentWorkflowOutcomes);
    expect(outcome?.processedAt).toBeInstanceOf(Date);
  });

  it('expires one incomplete checkout across workers', async () => {
    const checkout = await createCheckout(new Date(Date.now() - 60_000));
    const provider = new RecordingProvider();
    provider.intents.set(
      checkout.paymentIntentId,
      providerIntent({
        ...checkout,
        orderId: checkout.order.orderId,
        status: 'requires_payment_method',
      }),
    );
    const capacity = new RecordingCapacity();
    const workers = [
      new TicketPurchaseExpiryService(orders, payments, provider, capacity),
      new TicketPurchaseExpiryService(orders, payments, provider, capacity),
    ];

    const claimed = await Promise.all(workers.map((worker) => worker.process()));

    expect(claimed.reduce((total, value) => total + value, 0)).toBe(1);
    expect(provider.cancellations).toEqual([checkout.paymentIntentId]);
    expect(capacity.released).toEqual([checkout.order.orderId]);
    await expect(orders.findById(checkout.order.orderId)).resolves.toMatchObject({
      expiryClaimedUntil: null,
      status: 'expired',
    });
  });

  it('reuses one refund after an ambiguous response', async () => {
    const checkout = await createCheckout(new Date(Date.now() - 60_000));
    await payments.applyReconciliation({
      intent: providerIntent({
        ...checkout,
        orderId: checkout.order.orderId,
        status: 'succeeded',
      }),
      now: new Date(),
      paymentId: checkout.paymentId,
      reconcileAfter: null,
      status: 'succeeded',
    });
    await orders.markExpired(checkout.order.orderId);
    const capacity = new RecordingCapacity('expired');
    const provider = new RecordingProvider(true);
    const worker = new TicketPurchaseCompletionService(
      payments,
      orders,
      capacity,
      provider,
    );

    await expect(worker.process()).resolves.toBe(1);
    await database
      .update(paymentWorkflowOutcomes)
      .set({ availableAt: new Date(0), claimedUntil: null })
      .where(eq(paymentWorkflowOutcomes.paymentId, checkout.paymentId));
    await expect(worker.process()).resolves.toBe(1);

    expect(new Set(provider.refundKeys)).toEqual(
      new Set([`stripe-refund:${checkout.paymentId}`]),
    );
    expect(provider.refunds.size).toBe(1);
    const [refund] = await database.select().from(paymentRefunds);
    expect(refund).toMatchObject({
      paymentId: checkout.paymentId,
      status: 'succeeded',
    });
    await expect(orders.findById(checkout.order.orderId)).resolves.toMatchObject({
      status: 'refunded',
    });
    const [outcome] = await database.select().from(paymentWorkflowOutcomes);
    expect(outcome).toMatchObject({ failures: 1 });
    expect(outcome?.processedAt).toBeInstanceOf(Date);
  });

  it('persists a terminal refund failure', async () => {
    const checkout = await createCheckout(new Date(Date.now() - 60_000));
    await payments.applyReconciliation({
      intent: providerIntent({
        ...checkout,
        orderId: checkout.order.orderId,
        status: 'succeeded',
      }),
      now: new Date(),
      paymentId: checkout.paymentId,
      reconcileAfter: null,
      status: 'succeeded',
    });
    await orders.markExpired(checkout.order.orderId);
    const worker = new TicketPurchaseCompletionService(
      payments,
      orders,
      new RecordingCapacity('expired'),
      new RecordingProvider(false, 'failed'),
    );

    await expect(worker.process()).resolves.toBe(1);

    const [refund] = await database.select().from(paymentRefunds);
    expect(refund).toMatchObject({
      paymentId: checkout.paymentId,
      status: 'failed',
    });
    await expect(orders.findById(checkout.order.orderId)).resolves.toMatchObject({
      status: 'refunding',
    });
    const [outcome] = await database.select().from(paymentWorkflowOutcomes);
    expect(outcome?.processedAt).toBeInstanceOf(Date);
  });
});
