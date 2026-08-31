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
import { Controller, Inject } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { from, type Observable } from 'rxjs';

import { OrderRepository } from '../../orders/repositories/order.repository';
import type { CommerceOrderRecord } from '../../orders/types/order.types';
import {
  GetCommerceOrderDto,
  StartTicketPurchaseDto,
} from '../dto/ticket-purchase.dto';
import { TICKET_PURCHASE_MANAGEMENT } from '../ticket-purchase.tokens';
import type { TicketPurchaseManagement } from '../types/ticket-purchase.types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const START_ERROR_MESSAGES = new Map<number, string>([
  [status.RESOURCE_EXHAUSTED, 'EVENT_TICKET_CAPACITY_UNAVAILABLE'],
  [status.FAILED_PRECONDITION, 'EVENT_TICKET_CHECKOUT_UNAVAILABLE'],
  [status.ALREADY_EXISTS, 'EVENT_CAPACITY_RESERVATION_CONFLICT'],
  [status.DEADLINE_EXCEEDED, 'EVENT_CAPACITY_DEADLINE_EXCEEDED'],
  [status.UNAVAILABLE, 'EVENT_CAPACITY_UNAVAILABLE'],
]);

@Controller()
@CommerceServiceControllerMethods()
export class TicketPurchaseController implements CommerceServiceController {
  constructor(
    private readonly orders: OrderRepository,
    @Inject(TICKET_PURCHASE_MANAGEMENT)
    private readonly purchases: TicketPurchaseManagement,
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
    if (
      error instanceof Error &&
      error.message === 'Order idempotency conflict'
    ) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'COMMERCE_ORDER_IDEMPOTENCY_CONFLICT',
      });
    }

    const code = this.readGrpcCode(error);
    const message =
      code === undefined ? undefined : START_ERROR_MESSAGES.get(code);
    if (code !== undefined && message !== undefined) {
      throw new RpcException({ code, message });
    }

    throw new RpcException({
      code: status.INTERNAL,
      message: 'COMMERCE_CHECKOUT_FAILED',
    });
  }

  private readGrpcCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
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
      currency: order.currency ?? undefined,
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
