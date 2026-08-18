import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class EventWaitlistPathDto {
  @IsUUID()
  eventId!: string;

  @IsUUID()
  ticketTypeId!: string;
}

export class JoinEventWaitlistBodyDto {
  @ApiProperty({ minimum: 1, maximum: 1_000_000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

export class EventWaitlistEntryDto {
  @ApiProperty()
  waitlistEntryId!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  ticketTypeId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ enum: ['waiting', 'eligible'] })
  status!: 'waiting' | 'eligible';

  @ApiPropertyOptional({ nullable: true })
  position!: number | null;

  @ApiPropertyOptional()
  eligibleAt?: string;

  @ApiPropertyOptional()
  opportunityExpiresAt?: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
