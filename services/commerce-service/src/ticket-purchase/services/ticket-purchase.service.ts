import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { OrderRepository } from '../../orders/repositories/order.repository';
import type { CommerceOrderRecord } from '../../orders/types/order.types';
import { EVENT_CAPACITY_PORT } from '../ticket-purchase.tokens';
import type { EventCapacityPort } from '../types/event-capacity.port';
import type {
  StartTicketPurchaseCommand,
  TicketPurchaseManagement,
} from '../types/ticket-purchase.types';

@Injectable()
export class TicketPurchaseService implements TicketPurchaseManagement {
  constructor(
    private readonly orders: OrderRepository,
    @Inject(EVENT_CAPACITY_PORT)
    private readonly capacity: EventCapacityPort,
  ) {}

  async start(input: StartTicketPurchaseCommand): Promise<CommerceOrderRecord> {
    const orderId = randomUUID();
    const order = await this.orders.createPending({
      ...input,
      orderId,
    });
    if (order.status === 'pending_payment') return order;

    const reservation = await this.capacity.reserve({
      attendeeId: input.attendeeId,
      eventId: input.eventId,
      quantity: input.quantity,
      reservationId: order.orderId,
      ticketTypeId: input.ticketTypeId,
      requestId: input.requestId,
    });
    const totalMinor = reservation.unitPriceMinor * reservation.quantity;
    if (!Number.isSafeInteger(totalMinor)) {
      throw new Error('ORDER_TOTAL_OUT_OF_RANGE');
    }
    return this.orders.markReserved({
      currency: reservation.currency,
      orderId: order.orderId,
      quantity: reservation.quantity,
      reservationExpiresAt: reservation.expiresAt,
      ticketName: reservation.ticketName,
      totalMinor,
      unitPriceMinor: reservation.unitPriceMinor,
    });
  }
}
