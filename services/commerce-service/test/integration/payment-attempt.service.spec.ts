import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { count, eq } from 'drizzle-orm';
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
} from '../../src/payments/schema/payment-attempt.schema';
import { PaymentAttemptService } from '../../src/payments/services/payment-attempt.service';
import { PaymentProviderEventService } from '../../src/payments/services/payment-provider-event.service';
import { PaymentReconciliationService } from '../../src/payments/services/payment-reconciliation.service';
import type {
  CreateProviderPaymentIntentCommand,
  PaymentProviderPort,
  ProviderPaymentIntent,
  PaymentWebhookVerifier,
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

class IdempotentPaymentProvider implements PaymentProviderPort {
  readonly keys: string[] = [];
  readonly intents = new Map<string, ProviderPaymentIntent>();
  readonly retrievals: string[] = [];

  constructor(private failuresRemaining = 0) {}

  createIntent(
    input: CreateProviderPaymentIntentCommand,
  ): Promise<ProviderPaymentIntent> {
    this.keys.push(input.idempotencyKey);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new Error('PAYMENT_PROVIDER_UNAVAILABLE'));
    }
    const existing = this.intents.get(input.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);
    const created = {
      amountMinor: input.amountMinor,
      clientSecret: `pi_${input.paymentId.replaceAll('-', '')}_secret_confirmation`,
      currency: input.currency,
      hasLastPaymentError: false,
      metadata: {
        eventa_order_id: input.orderId,
        eventa_payment_id: input.paymentId,
      },
      paymentIntentId: `pi_${input.paymentId.replaceAll('-', '')}`,
      status: 'requires_payment_method',
    };
    this.intents.set(input.idempotencyKey, created);
    return Promise.resolve(created);
  }

  retrieveIntent(paymentIntentId: string): Promise<ProviderPaymentIntent> {
    this.retrievals.push(paymentIntentId);
    const intent = [...this.intents.values()].find(
      (candidate) => candidate.paymentIntentId === paymentIntentId,
    );
    if (intent === undefined) throw new Error('Provider payment missing');
    return Promise.resolve(intent);
  }
}

function verifier(input: {
  eventId: string;
  eventType: string;
  paymentIntentId: string;
  providerCreatedAt?: Date;
}): PaymentWebhookVerifier {
  return {
    verifyWebhook: () => ({
      providerCreatedAt:
        input.providerCreatedAt ?? new Date('2026-08-31T12:00:00.000Z'),
      ...input,
    }),
  };
}

const client = postgres(requiredTestDatabaseUrl, {
  max: 10,
  onnotice: () => undefined,
});
const database = drizzle(client);
const orders = new OrderRepository(database);
const attempts = new PaymentAttemptRepository(database);

async function createPayableOrder() {
  const order = await orders.createPending({
    attendeeId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
    eventId: 'c0caa9fc-6f69-4118-ad7f-110d872da987',
    idempotencyKey: randomUUID(),
    orderId: randomUUID(),
    quantity: 2,
    ticketTypeId: 'd0caa9fc-6f69-4118-ad7f-110d872da987',
  });
  return orders.markReserved({
    currency: 'NGN',
    orderId: order.orderId,
    quantity: 2,
    reservationExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
    ticketName: 'Standard',
    totalMinor: 5_000,
    unitPriceMinor: 2_500,
  });
}

describe('PaymentAttemptService integration', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(paymentProviderEvents);
    await database.delete(paymentAttempts);
    await database.delete(commerceOrderItems);
    await database.delete(commerceOrders);
  });

  afterAll(async () => {
    await database.delete(paymentProviderEvents);
    await database.delete(paymentAttempts);
    await database.delete(commerceOrderItems);
    await database.delete(commerceOrders);
    await client.end();
  });

  it('returns one payment for an exact retry', async () => {
    const order = await createPayableOrder();
    if (order.totalMinor === null || order.currency === null) {
      throw new Error('Payable order quote missing');
    }
    const provider = new IdempotentPaymentProvider();
    const payments = new PaymentAttemptService(attempts, provider);
    const input = {
      amountMinor: order.totalMinor,
      attendeeId: order.attendeeId,
      currency: order.currency,
      orderId: order.orderId,
    };

    const first = await payments.prepare(input);
    const retried = await payments.prepare(input);

    expect(retried).toEqual(first);
    expect(provider.intents.size).toBe(1);
    const [persisted] = await database.select().from(paymentAttempts);
    expect(persisted?.providerPaymentIntentId).toMatch(/^pi_/);
    expect(persisted).toMatchObject({
      id: first.paymentId,
      orderId: order.orderId,
      status: 'awaiting_confirmation',
    });
  });

  it('reuses the provider key after an ambiguous failure', async () => {
    const order = await createPayableOrder();
    if (order.totalMinor === null || order.currency === null) {
      throw new Error('Payable order quote missing');
    }
    const provider = new IdempotentPaymentProvider(1);
    const payments = new PaymentAttemptService(attempts, provider);
    const input = {
      amountMinor: order.totalMinor,
      attendeeId: order.attendeeId,
      currency: order.currency,
      orderId: order.orderId,
    };

    await expect(payments.prepare(input)).rejects.toThrow(
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
    const recovered = await payments.prepare(input);
    expect(recovered.paymentId).not.toBe('');

    expect(new Set(provider.keys).size).toBe(1);
    const [attemptCount] = await database
      .select({ value: count() })
      .from(paymentAttempts);
    expect(attemptCount?.value).toBe(1);
  });

  it('deduplicates concurrent provider events', async () => {
    const order = await createPayableOrder();
    if (order.totalMinor === null || order.currency === null) {
      throw new Error('Payable order quote missing');
    }
    const provider = new IdempotentPaymentProvider();
    const payments = new PaymentAttemptService(attempts, provider);
    const confirmation = await payments.prepare({
      amountMinor: order.totalMinor,
      attendeeId: order.attendeeId,
      currency: order.currency,
      orderId: order.orderId,
    });
    const [intent] = provider.intents.values();
    if (intent === undefined) throw new Error('Provider payment missing');
    intent.status = 'succeeded';

    const events = new PaymentProviderEventService(
      attempts,
      provider,
      verifier({
        eventId: 'evt_eventa_concurrent_success',
        eventType: 'payment_intent.succeeded',
        paymentIntentId: intent.paymentIntentId,
      }),
    );
    const outcomes = await Promise.all([
      events.handle(Buffer.from('{}'), 't=1,v1=signature'),
      events.handle(Buffer.from('{}'), 't=1,v1=signature'),
    ]);

    expect(new Set(outcomes)).toEqual(new Set(['processed', 'duplicate']));
    const [payment] = await database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, confirmation.paymentId));
    expect(payment).toMatchObject({
      providerStatus: 'succeeded',
      status: 'succeeded',
    });
    const [eventCount] = await database
      .select({ value: count() })
      .from(paymentProviderEvents);
    expect(eventCount?.value).toBe(1);
  });

  it('binds an event after a lost provider response', async () => {
    const order = await createPayableOrder();
    if (order.totalMinor === null || order.currency === null) {
      throw new Error('Payable order quote missing');
    }
    const paymentId = randomUUID();
    const providerIdempotencyKey = `eventa-payment:${paymentId}`;
    await attempts.createPending({
      amountMinor: order.totalMinor,
      attendeeId: order.attendeeId,
      currency: order.currency,
      orderId: order.orderId,
      paymentId,
      providerIdempotencyKey,
      reconcileAfter: new Date(),
    });
    const provider = new IdempotentPaymentProvider();
    const intent = await provider.createIntent({
      amountMinor: order.totalMinor,
      currency: order.currency,
      idempotencyKey: providerIdempotencyKey,
      orderId: order.orderId,
      paymentId,
    });

    const events = new PaymentProviderEventService(
      attempts,
      provider,
      verifier({
        eventId: 'evt_eventa_created_recovery',
        eventType: 'payment_intent.created',
        paymentIntentId: intent.paymentIntentId,
      }),
    );
    await expect(
      events.handle(Buffer.from('{}'), 't=1,v1=signature'),
    ).resolves.toBe('processed');

    const [payment] = await database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, paymentId));
    expect(payment).toMatchObject({
      providerPaymentIntentId: intent.paymentIntentId,
      status: 'awaiting_confirmation',
    });
  });

  it('replays a lost provider response with the same key', async () => {
    const order = await createPayableOrder();
    if (order.totalMinor === null || order.currency === null) {
      throw new Error('Payable order quote missing');
    }
    const paymentId = randomUUID();
    const providerIdempotencyKey = `eventa-payment:${paymentId}`;
    await attempts.createPending({
      amountMinor: order.totalMinor,
      attendeeId: order.attendeeId,
      currency: order.currency,
      orderId: order.orderId,
      paymentId,
      providerIdempotencyKey,
      reconcileAfter: new Date(),
    });
    const provider = new IdempotentPaymentProvider();
    await provider.createIntent({
      amountMinor: order.totalMinor,
      currency: order.currency,
      idempotencyKey: providerIdempotencyKey,
      orderId: order.orderId,
      paymentId,
    });

    const reconciliation = new PaymentReconciliationService(attempts, provider);
    await expect(reconciliation.reconcile()).resolves.toBe(1);

    expect(new Set(provider.keys)).toEqual(new Set([providerIdempotencyKey]));
    expect(provider.intents.size).toBe(1);
    const [payment] = await database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, paymentId));
    expect(payment?.providerPaymentIntentId).toMatch(/^pi_/);
    expect(payment?.status).toBe('awaiting_confirmation');
  });

  it('recovers a missed success through reconciliation', async () => {
    const order = await createPayableOrder();
    if (order.totalMinor === null || order.currency === null) {
      throw new Error('Payable order quote missing');
    }
    const provider = new IdempotentPaymentProvider();
    const payments = new PaymentAttemptService(attempts, provider);
    const confirmation = await payments.prepare({
      amountMinor: order.totalMinor,
      attendeeId: order.attendeeId,
      currency: order.currency,
      orderId: order.orderId,
    });
    const [intent] = provider.intents.values();
    if (intent === undefined) throw new Error('Provider payment missing');
    intent.status = 'succeeded';

    const reconciliation = new PaymentReconciliationService(attempts, provider);
    await expect(reconciliation.reconcile()).resolves.toBe(1);

    const [payment] = await database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, confirmation.paymentId));
    expect(payment).toMatchObject({
      providerStatus: 'succeeded',
      reconciliationFailures: 0,
      status: 'succeeded',
    });
    expect(payment?.lastReconciledAt).toBeInstanceOf(Date);
    expect(payment?.reconcileAfter).toBeNull();
  });

  it('leases reconciliation across workers', async () => {
    const order = await createPayableOrder();
    if (order.totalMinor === null || order.currency === null) {
      throw new Error('Payable order quote missing');
    }
    const provider = new IdempotentPaymentProvider();
    const payments = new PaymentAttemptService(attempts, provider);
    await payments.prepare({
      amountMinor: order.totalMinor,
      attendeeId: order.attendeeId,
      currency: order.currency,
      orderId: order.orderId,
    });
    const workers = [
      new PaymentReconciliationService(attempts, provider),
      new PaymentReconciliationService(attempts, provider),
    ];

    const claimed = await Promise.all(
      workers.map((worker) => worker.reconcile()),
    );

    expect(claimed.reduce((total, value) => total + value, 0)).toBe(1);
    expect(provider.retrievals).toHaveLength(1);
  });
});
