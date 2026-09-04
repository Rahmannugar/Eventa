import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { COMMERCE_DATABASE } from '../../database/database.constants';
import type { CommerceDatabase } from '../../database/database.types';
import { commerceOrderItems, commerceOrders } from '../schema/order.schema';
import { commerceOrderOutbox } from '../schema/order-outbox.schema';
import type {
  CommerceOrderRecord,
  CommerceOrderRepository,
  CreatePendingOrderCommand,
} from '../types/order.types';

const ORDER_COLUMNS = {
  orderId: commerceOrders.id,
  attendeeId: commerceOrders.attendeeId,
  idempotencyKey: commerceOrders.idempotencyKey,
  eventId: commerceOrders.eventId,
  ticketTypeId: commerceOrders.ticketTypeId,
  requestedQuantity: commerceOrders.requestedQuantity,
  status: commerceOrders.status,
  currency: commerceOrders.currency,
  totalMinor: commerceOrders.totalMinor,
  reservationExpiresAt: commerceOrders.reservationExpiresAt,
  failureCode: commerceOrders.failureCode,
  expiryClaimedUntil: commerceOrders.expiryClaimedUntil,
  expiryFailures: commerceOrders.expiryFailures,
  createdAt: commerceOrders.createdAt,
  updatedAt: commerceOrders.updatedAt,
};

@Injectable()
export class OrderRepository implements CommerceOrderRepository {
  constructor(
    @Inject(COMMERCE_DATABASE)
    private readonly database: CommerceDatabase,
  ) {}

  async createPending(
    input: CreatePendingOrderCommand,
  ): Promise<CommerceOrderRecord> {
    const [created] = await this.database
      .insert(commerceOrders)
      .values({
        id: input.orderId,
        attendeeId: input.attendeeId,
        idempotencyKey: input.idempotencyKey,
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId,
        requestedQuantity: input.quantity,
      })
      .onConflictDoNothing({
        target: [commerceOrders.attendeeId, commerceOrders.idempotencyKey],
      })
      .returning(ORDER_COLUMNS);

    if (created !== undefined) return created;

    const [existing] = await this.database
      .select(ORDER_COLUMNS)
      .from(commerceOrders)
      .where(
        and(
          eq(commerceOrders.attendeeId, input.attendeeId),
          eq(commerceOrders.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing === undefined) throw new Error('Order idempotency record missing');
    if (
      existing.attendeeId !== input.attendeeId ||
      existing.eventId !== input.eventId ||
      existing.ticketTypeId !== input.ticketTypeId ||
      existing.requestedQuantity !== input.quantity
    ) {
      throw new Error('Order idempotency conflict');
    }
    return existing;
  }

  async findById(orderId: string): Promise<CommerceOrderRecord | undefined> {
    const [order] = await this.database
      .select(ORDER_COLUMNS)
      .from(commerceOrders)
      .where(eq(commerceOrders.id, orderId))
      .limit(1);
    return order;
  }

  async markReserved(input: {
    orderId: string;
    ticketName: string;
    quantity: number;
    unitPriceMinor: number;
    currency: string;
    totalMinor: number;
    reservationExpiresAt: Date;
  }): Promise<CommerceOrderRecord> {
    return this.database.transaction(async (transaction) => {
      const [order] = await transaction
        .select(ORDER_COLUMNS)
        .from(commerceOrders)
        .where(eq(commerceOrders.id, input.orderId))
        .limit(1)
        .for('update');
      if (order === undefined) throw new Error('Order disappeared while reserving');
      if (order.status === 'pending_payment') return order;
      if (order.status !== 'pending_reservation') {
        throw new Error('Order cannot accept a capacity reservation');
      }

      await transaction.insert(commerceOrderItems).values({
        orderId: input.orderId,
        ticketName: input.ticketName,
        quantity: input.quantity,
        unitPriceMinor: input.unitPriceMinor,
        lineTotalMinor: input.totalMinor,
      });
      const [updated] = await transaction
        .update(commerceOrders)
        .set({
          currency: input.currency,
          totalMinor: input.totalMinor,
          reservationExpiresAt: input.reservationExpiresAt,
          status: 'pending_payment',
          updatedAt: new Date(),
        })
        .where(eq(commerceOrders.id, input.orderId))
        .returning(ORDER_COLUMNS);
      if (updated === undefined) throw new Error('Order disappeared while reserving');
      return updated;
    });
  }

  markPaid(orderId: string): Promise<CommerceOrderRecord> {
    return this.transition(orderId, 'paid');
  }

  markFailed(input: {
    orderId: string;
    failureCode: string;
  }): Promise<CommerceOrderRecord> {
    return this.transition(input.orderId, 'failed', input.failureCode);
  }

  markExpired(orderId: string): Promise<CommerceOrderRecord> {
    return this.transition(orderId, 'expired');
  }

  markRefunding(orderId: string): Promise<CommerceOrderRecord> {
    return this.transition(orderId, 'refunding');
  }

  markRefunded(orderId: string): Promise<CommerceOrderRecord> {
    return this.transition(orderId, 'refunded');
  }

  async claimExpired(input: {
    now: Date;
    claimedUntil: Date;
    limit: number;
  }): Promise<CommerceOrderRecord[]> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select(ORDER_COLUMNS)
        .from(commerceOrders)
        .where(and(
          eq(commerceOrders.status, 'pending_payment'),
          lte(commerceOrders.reservationExpiresAt, input.now),
          or(isNull(commerceOrders.expiryClaimedUntil), lt(commerceOrders.expiryClaimedUntil, input.now)),
        ))
        .orderBy(asc(commerceOrders.reservationExpiresAt), asc(commerceOrders.id))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];
      await transaction.update(commerceOrders)
        .set({ expiryClaimedUntil: input.claimedUntil })
        .where(inArray(commerceOrders.id, rows.map((row) => row.orderId)));
      return rows;
    });
  }

  async releaseExpiryClaim(input: { orderId: string; failed: boolean }): Promise<void> {
    await this.database.update(commerceOrders).set({
      expiryClaimedUntil: null,
      ...(input.failed ? { expiryFailures: sql`${commerceOrders.expiryFailures} + 1` } : {}),
      updatedAt: new Date(),
    }).where(eq(commerceOrders.id, input.orderId));
  }

  private async transition(
    orderId: string,
    status: 'paid' | 'failed' | 'expired' | 'refunding' | 'refunded',
    failureCode?: string,
  ): Promise<CommerceOrderRecord> {
    return this.database.transaction(async (transaction) => {
      const [order] = await transaction
        .select(ORDER_COLUMNS)
        .from(commerceOrders)
        .where(eq(commerceOrders.id, orderId))
        .limit(1)
        .for('update');
      if (order === undefined) throw new Error('Order disappeared');
      if (order.status === status) return order;
      if (
        order.status !== 'pending_payment' &&
        !(status === 'refunding' && order.status === 'expired') &&
        !(order.status === 'refunding' && status === 'refunded')
      ) {
        throw new Error('ORDER_TRANSITION_CONFLICT');
      }
      const [updated] = await transaction
        .update(commerceOrders)
        .set({
          expiryClaimedUntil: null,
          failureCode: status === 'failed' ? failureCode : null,
          status,
          updatedAt: new Date(),
        })
        .where(eq(commerceOrders.id, orderId))
        .returning(ORDER_COLUMNS);
      if (updated === undefined) throw new Error('Order disappeared');
      if (status === 'paid') {
        const [item] = await transaction
          .select({ quantity: commerceOrderItems.quantity })
          .from(commerceOrderItems)
          .where(eq(commerceOrderItems.orderId, orderId))
          .limit(1);
        if (item === undefined || updated.currency === null || updated.totalMinor === null) {
          throw new Error('PAID_ORDER_SNAPSHOT_INCOMPLETE');
        }
        const messageId = randomUUID();
        await transaction.insert(commerceOrderOutbox).values({
          aggregateId: updated.orderId,
          aggregateType: 'eventa.commerce.order.v1',
          eventId: messageId,
          eventType: 'commerce.order-paid.v1',
          payload: {
            attendeeId: updated.attendeeId,
            currency: updated.currency,
            eventId: updated.eventId,
            messageId,
            orderId: updated.orderId,
            paidAt: updated.updatedAt.toISOString(),
            quantity: item.quantity,
            ticketTypeId: updated.ticketTypeId,
            totalMinor: updated.totalMinor,
            type: 'commerce.order-paid.v1',
          },
        });
      }
      return updated;
    });
  }
}
