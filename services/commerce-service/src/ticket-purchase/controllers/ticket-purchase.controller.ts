import {
  CommerceOrderStatus,
  CommerceServiceControllerMethods,
  type CommerceOrder,
  type CommerceServiceController,
  type GetCommerceOrderRequest,
  type GetCommerceOrderResponse,
  type StartTicketPurchaseRequest,
  type StartTicketPurchaseResponse,
} from '@eventa/grpc-contracts';
import { Controller } from '@nestjs/common';
import { from, type Observable } from 'rxjs';

import { OrderRepository } from '../../orders/repositories/order.repository';
import type { CommerceOrderRecord } from '../../orders/types/order.types';
import { TicketPurchaseService } from '../services/ticket-purchase.service';

@Controller()
@CommerceServiceControllerMethods()
export class TicketPurchaseController implements CommerceServiceController {
  constructor(
    private readonly orders: OrderRepository,
    private readonly purchases: TicketPurchaseService,
  ) {}

  startTicketPurchase(
    request: StartTicketPurchaseRequest,
  ): Observable<StartTicketPurchaseResponse> {
    return from(this.start(request));
  }

  private async start(
    request: StartTicketPurchaseRequest,
  ): Promise<StartTicketPurchaseResponse> {
    const order = await this.purchases.start({
      attendeeId: request.attendeeId,
      eventId: request.eventId,
      idempotencyKey: request.idempotencyKey,
      quantity: request.quantity,
      requestId: request.idempotencyKey,
      ticketTypeId: request.ticketTypeId,
    });
    return { order: this.toContract(order) };
  }

  getCommerceOrder(
    request: GetCommerceOrderRequest,
  ): Observable<GetCommerceOrderResponse> {
    return from(this.get(request));
  }

  private async get(
    request: GetCommerceOrderRequest,
  ): Promise<GetCommerceOrderResponse> {
    const order = await this.orders.findById(request.orderId);
    if (order === undefined || order.attendeeId !== request.attendeeId) {
      throw new Error('COMMERCE_ORDER_NOT_FOUND');
    }
    return { order: this.toContract(order) };
  }

  private toContract(order: CommerceOrderRecord): CommerceOrder {
    return {
      attendeeId: order.attendeeId,
      createdAt: order.createdAt.toISOString(),
      eventId: order.eventId,
      orderId: order.orderId,
      quantity: order.requestedQuantity,
      reservationExpiresAt: order.reservationExpiresAt?.toISOString(),
      status: {
        expired: CommerceOrderStatus.COMMERCE_ORDER_STATUS_EXPIRED,
        failed: CommerceOrderStatus.COMMERCE_ORDER_STATUS_FAILED,
        paid: CommerceOrderStatus.COMMERCE_ORDER_STATUS_PAID,
        pending_payment:
          CommerceOrderStatus.COMMERCE_ORDER_STATUS_PENDING_PAYMENT,
        pending_reservation:
          CommerceOrderStatus.COMMERCE_ORDER_STATUS_PENDING_RESERVATION,
        refunded: CommerceOrderStatus.COMMERCE_ORDER_STATUS_REFUNDED,
        refunding: CommerceOrderStatus.COMMERCE_ORDER_STATUS_REFUNDING,
      }[order.status],
      ticketTypeId: order.ticketTypeId,
      totalMinor: order.totalMinor ?? undefined,
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
