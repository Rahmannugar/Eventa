import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { COMMERCE_DATABASE } from '../../database/database.constants';
import type { CommerceDatabase } from '../../database/database.types';
import { commerceOrders } from '../schema/order.schema';
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
      .where(eq(commerceOrders.id, input.orderId))
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
    currency: string;
    totalMinor: number;
    reservationExpiresAt: Date;
  }): Promise<CommerceOrderRecord> {
    const [updated] = await this.database
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
  }
}
