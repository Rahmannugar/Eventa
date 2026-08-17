import type {
  FinalizeEventCapacityReservationRequest,
  ReleaseEventCapacityReservationRequest,
  ReserveEventCapacityRequest,
} from '@eventa/grpc-contracts';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class ReserveEventCapacityDto implements ReserveEventCapacityRequest {
  @IsUUID()
  reservationId!: string;

  @IsUUID()
  eventId!: string;

  @IsUUID()
  ticketTypeId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

export class FinalizeEventCapacityReservationDto implements FinalizeEventCapacityReservationRequest {
  @IsUUID()
  reservationId!: string;

  @IsUUID()
  eventId!: string;

  @IsUUID()
  ticketTypeId!: string;
}

export class ReleaseEventCapacityReservationDto implements ReleaseEventCapacityReservationRequest {
  @IsUUID()
  reservationId!: string;

  @IsUUID()
  eventId!: string;

  @IsUUID()
  ticketTypeId!: string;
}
