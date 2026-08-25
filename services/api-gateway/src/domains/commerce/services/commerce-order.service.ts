import {
  CommerceOrderStatus,
  type CommerceOrder,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ApiHttpException } from '../../../http/errors/api-http.exception';
import {
  COMMERCE_GRPC_CLIENT,
  COMMERCE_GRPC_DEADLINE_MS,
} from '../constants/commerce.constants';
import type {
  CheckoutOrderDto,
  StartCheckoutDto,
} from '../dto/commerce-order.dto';
import type { DeadlineAwareCommerceClient } from '../types/commerce-grpc-client.types';

function code(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}
function details(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'details' in error
    ? Reflect.get(error, 'details')
    : undefined;
}

@Injectable()
export class CommerceOrderService implements OnModuleInit {
  private client?: DeadlineAwareCommerceClient;
  constructor(
    @Inject(COMMERCE_GRPC_CLIENT) private readonly grpc: ClientGrpc,
    @Inject(COMMERCE_GRPC_DEADLINE_MS) private readonly deadlineMs: number,
  ) {}
  onModuleInit(): void {
    this.client =
      this.grpc.getService<DeadlineAwareCommerceClient>('CommerceService');
  }
  async start(
    input: StartCheckoutDto,
    attendeeId: string,
    requestId: string,
  ): Promise<CheckoutOrderDto> {
    try {
      const response = await firstValueFrom(
        this.require().startTicketPurchase(
          { ...input, attendeeId },
          this.metadata(requestId),
          this.options(),
        ),
      );
      return this.toDto(response.order, attendeeId);
    } catch (error: unknown) {
      this.translate(error);
    }
  }
  async get(
    orderId: string,
    attendeeId: string,
    requestId: string,
  ): Promise<CheckoutOrderDto> {
    try {
      const response = await firstValueFrom(
        this.require().getCommerceOrder(
          { orderId, attendeeId },
          this.metadata(requestId),
          this.options(),
        ),
      );
      return this.toDto(response.order, attendeeId);
    } catch (error: unknown) {
      this.translate(error);
    }
  }
  private toDto(
    order: CommerceOrder | undefined,
    attendeeId: string,
  ): CheckoutOrderDto {
    if (
      order === undefined ||
      order.attendeeId !== attendeeId ||
      order.orderId === '' ||
      order.eventId === '' ||
      order.ticketTypeId === '' ||
      !Number.isInteger(order.quantity) ||
      order.quantity < 1 ||
      !order.createdAt ||
      !order.updatedAt ||
      Date.parse(order.updatedAt) < Date.parse(order.createdAt) ||
      order.status === CommerceOrderStatus.COMMERCE_ORDER_STATUS_UNSPECIFIED
    )
      throw this.unavailable('COMMERCE_ORDER_RESPONSE_INVALID');
    const statusName = CommerceOrderStatus[order.status];
    if (statusName === undefined)
      throw this.unavailable('COMMERCE_ORDER_RESPONSE_INVALID');
    return {
      orderId: order.orderId,
      eventId: order.eventId,
      ticketTypeId: order.ticketTypeId,
      quantity: order.quantity,
      status: statusName.replace('COMMERCE_ORDER_STATUS_', '').toLowerCase(),
      ...(order.currency === undefined ? {} : { currency: order.currency }),
      ...(order.totalMinor === undefined
        ? {}
        : { totalMinor: order.totalMinor }),
      ...(order.reservationExpiresAt === undefined
        ? {}
        : { reservationExpiresAt: order.reservationExpiresAt }),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
  private translate(error: unknown): never {
    if (error instanceof ApiHttpException) throw error;
    const rpc = code(error);
    const detail = details(error);
    if (rpc === status.ALREADY_EXISTS)
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'CHECKOUT_IDEMPOTENCY_CONFLICT',
        'This checkout key was already used for different ticket details.',
      );
    if (rpc === status.NOT_FOUND)
      throw new ApiHttpException(
        HttpStatus.NOT_FOUND,
        'ORDER_NOT_FOUND',
        'Order was not found.',
      );
    if (
      rpc === status.RESOURCE_EXHAUSTED ||
      detail === 'EVENT_TICKET_CAPACITY_UNAVAILABLE'
    )
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'TICKETS_UNAVAILABLE',
        'Those tickets are no longer available.',
      );
    if (rpc === status.FAILED_PRECONDITION)
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'CHECKOUT_NOT_AVAILABLE',
        'This ticket cannot be purchased right now.',
      );
    if (rpc === status.DEADLINE_EXCEEDED || rpc === status.UNAVAILABLE)
      throw this.unavailable('COMMERCE_SERVICE_UNAVAILABLE');
    throw this.unavailable('COMMERCE_SERVICE_UNAVAILABLE');
  }
  private require(): DeadlineAwareCommerceClient {
    if (this.client === undefined)
      throw new Error('Commerce client unavailable');
    return this.client;
  }
  private metadata(requestId: string): Metadata {
    const m = new Metadata();
    m.set('x-request-id', requestId);
    return m;
  }
  private options(): { deadline: Date } {
    return { deadline: new Date(Date.now() + this.deadlineMs) };
  }
  private unavailable(codeValue: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      codeValue,
      'Checkout is temporarily unavailable. Try again later.',
    );
  }
}
