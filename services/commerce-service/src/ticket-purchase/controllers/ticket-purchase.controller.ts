import { randomUUID } from 'node:crypto';

import {
  CommerceOrderStatus,
  CommerceServiceControllerMethods,
  type CommerceOrder,
  type CommerceServiceController,
  type GetCommerceOrderResponse,
  type StartTicketPurchaseResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { from, type Observable } from 'rxjs';

import { OrderRepository } from '../../orders/repositories/order.repository';
import type { CommerceOrderRecord } from '../../orders/types/order.types';
import {
  GetCommerceOrderDto,
  StartTicketPurchaseDto,
} from '../dto/ticket-purchase.dto';
import { TicketPurchaseService } from '../services/ticket-purchase.service';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

@Controller()
@CommerceServiceControllerMethods()
export class TicketPurchaseController implements CommerceServiceController {
  constructor(
    private readonly orders: OrderRepository,
    private readonly purchases: TicketPurchaseService,
  ) {}

  startTicketPurchase(
    request: StartTicketPurchaseDto,
    metadata?: Metadata,
  ): Observable<StartTicketPurchaseResponse> {
    return from(this.start(request, this.readRequestId(metadata)));
  }

  private async start(
    request: StartTicketPurchaseDto,
    requestId: string,
  ): Promise<StartTicketPurchaseResponse> {
    try {
      const order = await this.purchases.start({
        attendeeId: request.attendeeId,
        eventId: request.eventId,
        idempotencyKey: request.idempotencyKey,
        quantity: request.quantity,
        requestId,
        ticketTypeId: request.ticketTypeId,
      });
      return { order: this.toContract(order) };
    } catch (error: unknown) {
      this.translateStartError(error);
    }
  }

  getCommerceOrder(
    request: GetCommerceOrderDto,
  ): Observable<GetCommerceOrderResponse> {
    return from(this.get(request));
  }

  private async get(
    request: GetCommerceOrderDto,
  ): Promise<GetCommerceOrderResponse> {
    const order = await this.orders.findById(request.orderId);
    if (order === undefined || order.attendeeId !== request.attendeeId) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'COMMERCE_ORDER_NOT_FOUND',
      });
    }
    return { order: this.toContract(order) };
  }

  private translateStartError(error: unknown): never {
    if (error instanceof Error && error.message === 'Order idempotency conflict') {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'COMMERCE_ORDER_IDEMPOTENCY_CONFLICT',
      });
    }
    throw error;
  }

  private readRequestId(metadata?: Metadata): string {
    const value = metadata?.get('x-request-id')[0];
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
      ? value
      : randomUUID();
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
