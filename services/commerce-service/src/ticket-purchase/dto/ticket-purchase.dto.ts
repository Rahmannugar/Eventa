import type {
  GetCommerceOrderRequest,
  StartTicketPurchaseRequest,
} from '@eventa/grpc-contracts';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class StartTicketPurchaseDto implements StartTicketPurchaseRequest {
  @IsUUID()
  attendeeId!: string;

  @IsUUID()
  idempotencyKey!: string;

  @IsUUID()
  eventId!: string;

  @IsUUID()
  ticketTypeId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

export class GetCommerceOrderDto implements GetCommerceOrderRequest {
  @IsUUID()
  attendeeId!: string;

  @IsUUID()
  orderId!: string;
}
