import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { COMMERCE_DATABASE } from '../../database/database.constants';
import type { CommerceDatabase } from '../../database/database.types';
import { commerceOrderItems, commerceOrders } from '../schema/order.schema';
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

  private async transition(
    orderId: string,
    status: 'paid' | 'failed',
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
      if (order.status !== 'pending_payment') {
        throw new Error('ORDER_TRANSITION_CONFLICT');
      }
      const [updated] = await transaction
        .update(commerceOrders)
        .set({
          failureCode: status === 'failed' ? failureCode : null,
          status,
          updatedAt: new Date(),
        })
        .where(eq(commerceOrders.id, orderId))
        .returning(ORDER_COLUMNS);
      if (updated === undefined) throw new Error('Order disappeared');
      return updated;
    });
  }
}
