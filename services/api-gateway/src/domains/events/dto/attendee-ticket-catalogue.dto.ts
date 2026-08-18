import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AttendeeTicketCataloguePathDto {
  @IsUUID()
  eventId!: string;
}

export class AttendeeTicketAvailabilityDto {
  @ApiProperty({
    enum: ['available', 'waiting', 'eligible', 'reserved', 'unavailable'],
  })
  status!: 'available' | 'waiting' | 'eligible' | 'reserved' | 'unavailable';

  @ApiProperty({ minimum: 0 })
  quantity!: number;

  @ApiProperty()
  salesOpen!: boolean;

  @ApiProperty()
  canJoinWaitlist!: boolean;

  @ApiPropertyOptional({ minimum: 1 })
  waitlistPosition?: number;

  @ApiPropertyOptional()
  opportunityExpiresAt?: string;

  @ApiPropertyOptional()
  reservationExpiresAt?: string;
}

export class AttendeeTicketTypeDto {
  @ApiProperty()
  ticketTypeId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ minimum: 0 })
  priceMinor!: number;

  @ApiProperty()
  salesStartAt!: string;

  @ApiProperty()
  salesEndAt!: string;

  @ApiProperty({ type: AttendeeTicketAvailabilityDto })
  availability!: AttendeeTicketAvailabilityDto;
}

export class AttendeeTicketCurrencyDto {
  @ApiProperty({ pattern: '^[A-Z]{3}$' })
  currency!: string;

  @ApiProperty({ type: () => [AttendeeTicketTypeDto] })
  ticketTypes!: AttendeeTicketTypeDto[];
}

export class AttendeeTicketCatalogueDto {
  @ApiProperty()
  eventId!: string;

  @ApiProperty({ type: () => [AttendeeTicketCurrencyDto] })
  currencies!: AttendeeTicketCurrencyDto[];
}
