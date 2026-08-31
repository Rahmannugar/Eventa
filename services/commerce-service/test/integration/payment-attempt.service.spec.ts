import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { count } from 'drizzle-orm';
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
import { paymentAttempts } from '../../src/payments/schema/payment-attempt.schema';
import { PaymentAttemptService } from '../../src/payments/services/payment-attempt.service';
import type {
  CreateProviderPaymentIntentCommand,
  PaymentProviderPort,
  ProviderPaymentIntent,
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
    const intent = [...this.intents.values()].find(
      (candidate) => candidate.paymentIntentId === paymentIntentId,
    );
    if (intent === undefined) throw new Error('Provider payment missing');
    return Promise.resolve(intent);
  }
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
    await database.delete(paymentAttempts);
    await database.delete(commerceOrderItems);
    await database.delete(commerceOrders);
  });

  afterAll(async () => {
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
});
