import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { OrderRepository } from '../../orders/repositories/order.repository';
import type { CommerceOrderRecord } from '../../orders/types/order.types';
import type { PaymentManagement } from '../../payments/types/payment-attempt.types';
import { EVENT_CAPACITY_PORT } from '../ticket-purchase.tokens';
import type { EventCapacityReservationPort } from '../types/event-capacity.port';
import type {
  StartTicketPurchaseCommand,
  StartTicketPurchaseResult,
  TicketPurchaseManagement,
} from '../types/ticket-purchase.types';

@Injectable()
export class TicketPurchaseService implements TicketPurchaseManagement {
  constructor(
    private readonly orders: OrderRepository,
    @Inject(EVENT_CAPACITY_PORT)
    private readonly capacity: EventCapacityReservationPort,
    private readonly payments: PaymentManagement,
  ) {}

  async start(
    input: StartTicketPurchaseCommand,
  ): Promise<StartTicketPurchaseResult> {
    const orderId = randomUUID();
    const order = await this.orders.createPending({
      ...input,
      orderId,
    });
    let payableOrder: CommerceOrderRecord;
    if (order.status === 'pending_reservation') {
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
      payableOrder = await this.orders.markReserved({
        currency: reservation.currency,
        orderId: order.orderId,
        quantity: reservation.quantity,
        reservationExpiresAt: reservation.expiresAt,
        ticketName: reservation.ticketName,
        totalMinor,
        unitPriceMinor: reservation.unitPriceMinor,
      });
    } else {
      payableOrder = order;
    }

    if (
      payableOrder.currency === null ||
      payableOrder.totalMinor === null ||
      payableOrder.reservationExpiresAt === null
    ) {
      throw new Error('ORDER_PAYMENT_QUOTE_INVALID');
    }
    if (
      payableOrder.status === 'pending_payment' &&
      payableOrder.reservationExpiresAt.getTime() <= Date.now()
    ) {
      throw new Error('ORDER_RESERVATION_EXPIRED');
    }
    const payment = await this.payments.prepare({
      amountMinor: payableOrder.totalMinor,
      attendeeId: payableOrder.attendeeId,
      currency: payableOrder.currency,
      orderId: payableOrder.orderId,
    });
    return { order: payableOrder, payment };
  }
}
