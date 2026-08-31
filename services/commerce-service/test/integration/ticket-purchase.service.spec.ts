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
import { TicketPurchaseService } from '../../src/ticket-purchase/services/ticket-purchase.service';
import { paymentAttempts } from '../../src/payments/schema/payment-attempt.schema';
import type {
  PaymentConfirmation,
  PaymentManagement,
} from '../../src/payments/types/payment-attempt.types';
import type {
  EventCapacityPort,
  EventCapacityQuote,
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
  const adminClient = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    const [state] = await adminClient<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_database WHERE datname = ${testDatabaseName}
      ) AS exists
    `;
    if (state?.exists !== true) {
      await adminClient.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
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
    await adminClient.end();
  }
}

const client = postgres(requiredTestDatabaseUrl, {
  max: 10,
  onnotice: () => undefined,
});
const database = drizzle(client);
const repository = new OrderRepository(database);

const purchaseInput = {
  attendeeId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
  eventId: 'c0caa9fc-6f69-4118-ad7f-110d872da987',
  idempotencyKey: 'e0caa9fc-6f69-4118-ad7f-110d872da987',
  quantity: 2,
  requestId: 'checkout-integration-request',
  ticketTypeId: 'd0caa9fc-6f69-4118-ad7f-110d872da987',
};

class RecordingCapacityPort implements EventCapacityPort {
  readonly reservationIds: string[] = [];

  constructor(private failuresRemaining = 0) {}

  reserve(
    input: Parameters<EventCapacityPort['reserve']>[0],
  ): Promise<EventCapacityQuote> {
    this.reservationIds.push(input.reservationId);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new Error('EVENT_CAPACITY_DEADLINE_EXCEEDED'));
    }
    return Promise.resolve({
      attendeeId: input.attendeeId,
      currency: 'NGN',
      eventId: input.eventId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      quantity: input.quantity,
      reservationId: input.reservationId,
      ticketName: 'Standard',
      ticketTypeId: input.ticketTypeId,
      unitPriceMinor: 2_500,
    });
  }
}

class RecordingPaymentManagement implements PaymentManagement {
  private readonly confirmations = new Map<string, PaymentConfirmation>();

  prepare(
    input: Parameters<PaymentManagement['prepare']>[0],
  ): Promise<PaymentConfirmation> {
    const existing = this.confirmations.get(input.orderId);
    if (existing !== undefined) return Promise.resolve(existing);
    const confirmation = {
      clientSecret: `secret-for-${input.orderId}`,
      paymentId: randomUUID(),
    };
    this.confirmations.set(input.orderId, confirmation);
    return Promise.resolve(confirmation);
  }
}

async function persistedCounts(): Promise<{ items: number; orders: number }> {
  const [itemCount] = await database
    .select({ value: count() })
    .from(commerceOrderItems);
  const [orderCount] = await database
    .select({ value: count() })
    .from(commerceOrders);
  return {
    items: itemCount?.value ?? 0,
    orders: orderCount?.value ?? 0,
  };
}

describe('TicketPurchaseService integration', () => {
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
    await client.end();
  });

  it('returns the same order for an exact retry', async () => {
    const capacity = new RecordingCapacityPort();
    const purchases = new TicketPurchaseService(
      repository,
      capacity,
      new RecordingPaymentManagement(),
    );

    const first = await purchases.start(purchaseInput);
    const retried = await purchases.start(purchaseInput);

    expect(retried).toEqual(first);
    expect(capacity.reservationIds).toEqual([first.order.orderId]);
    await expect(persistedCounts()).resolves.toEqual({ items: 1, orders: 1 });
  });

  it('rejects conflicting reuse of an attendee idempotency key', async () => {
    const capacity = new RecordingCapacityPort();
    const purchases = new TicketPurchaseService(
      repository,
      capacity,
      new RecordingPaymentManagement(),
    );
    await purchases.start(purchaseInput);

    await expect(
      purchases.start({ ...purchaseInput, quantity: 3 }),
    ).rejects.toThrow('Order idempotency conflict');
    expect(capacity.reservationIds).toHaveLength(1);
    await expect(persistedCounts()).resolves.toEqual({ items: 1, orders: 1 });
  });

  it('commits the ticket quote and order transition atomically', async () => {
    const order = await repository.createPending({
      ...purchaseInput,
      orderId: randomUUID(),
    });
    const reservationExpiresAt = new Date(Date.now() + 10 * 60 * 1_000);

    await expect(
      repository.markReserved({
        currency: 'NGN',
        orderId: order.orderId,
        quantity: 2,
        reservationExpiresAt,
        ticketName: 'Standard',
        totalMinor: 4_999,
        unitPriceMinor: 2_500,
      }),
    ).rejects.toBeDefined();
    await expect(repository.findById(order.orderId)).resolves.toMatchObject({
      status: 'pending_reservation',
      totalMinor: null,
    });
    await expect(persistedCounts()).resolves.toEqual({ items: 0, orders: 1 });

    await expect(
      repository.markReserved({
        currency: 'NGN',
        orderId: order.orderId,
        quantity: 2,
        reservationExpiresAt,
        ticketName: 'Standard',
        totalMinor: 5_000,
        unitPriceMinor: 2_500,
      }),
    ).resolves.toMatchObject({ status: 'pending_payment', totalMinor: 5_000 });
    const [item] = await database
      .select()
      .from(commerceOrderItems)
      .where(eq(commerceOrderItems.orderId, order.orderId));
    expect(item).toMatchObject({
      lineTotalMinor: 5_000,
      quantity: 2,
      ticketName: 'Standard',
      unitPriceMinor: 2_500,
    });
  });

  it('retries the same order after a capacity timeout', async () => {
    const capacity = new RecordingCapacityPort(1);
    const purchases = new TicketPurchaseService(
      repository,
      capacity,
      new RecordingPaymentManagement(),
    );

    await expect(purchases.start(purchaseInput)).rejects.toThrow(
      'EVENT_CAPACITY_DEADLINE_EXCEEDED',
    );
    const [pending] = await database.select().from(commerceOrders);
    expect(pending).toMatchObject({ status: 'pending_reservation' });

    const recovered = await purchases.start(purchaseInput);
    expect(recovered).toMatchObject({
      order: {
        orderId: pending?.id,
        status: 'pending_payment',
      },
    });
    expect(capacity.reservationIds).toEqual([pending?.id, pending?.id]);
    await expect(persistedCounts()).resolves.toEqual({ items: 1, orders: 1 });
  });

  it('creates one order and item for concurrent exact requests', async () => {
    const capacity = new RecordingCapacityPort();
    const purchases = new TicketPurchaseService(
      repository,
      capacity,
      new RecordingPaymentManagement(),
    );

    const results = await Promise.all([
      purchases.start(purchaseInput),
      purchases.start(purchaseInput),
    ]);

    expect(results[1]?.order.orderId).toBe(results[0]?.order.orderId);
    expect(
      results.every((result) => result.order.status === 'pending_payment'),
    ).toBe(true);
    expect(new Set(capacity.reservationIds)).toEqual(
      new Set([results[0]?.order.orderId]),
    );
    await expect(persistedCounts()).resolves.toEqual({ items: 1, orders: 1 });
  });
});
