import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AnalyticsListQueryDto {
  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;

  @ApiPropertyOptional({ enum: ['published', 'cancelled'] })
  @IsOptional()
  @IsIn(['published', 'cancelled'])
  status?: 'published' | 'cancelled';
}

export class AnalyticsEventPathDto {
  @IsUUID()
  eventId!: string;
}

export class EventPerformanceDto {
  @ApiProperty()
  eventId!: string;

  @ApiProperty({ enum: ['published', 'cancelled'] })
  status!: string;

  @ApiProperty({ description: 'ISO 4217 code, empty when no order has been recorded' })
  currency!: string;

  @ApiProperty()
  ticketsSold!: number;

  @ApiProperty()
  ticketsRefunded!: number;

  @ApiProperty()
  ticketsCheckedIn!: number;

  @ApiProperty()
  ticketsRevoked!: number;

  @ApiProperty({ description: 'Smallest currency unit' })
  grossRevenueMinor!: number;

  @ApiProperty({ description: 'Smallest currency unit' })
  refundedRevenueMinor!: number;

  @ApiProperty({ description: 'Gross minus refunded, smallest currency unit' })
  netRevenueMinor!: number;

  @ApiPropertyOptional()
  publishedAt?: string;

  @ApiPropertyOptional()
  cancelledAt?: string;

  @ApiProperty()
  updatedAt!: string;
}

export class AnalyticsEventListDto {
  @ApiProperty({ type: [EventPerformanceDto] })
  events!: EventPerformanceDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}

export class AnalyticsEventDto {
  @ApiProperty({ type: EventPerformanceDto })
  event!: EventPerformanceDto;
}

export class CurrencyTotalsDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty()
  ticketsSold!: number;

  @ApiProperty()
  ticketsRefunded!: number;

  @ApiProperty({ description: 'Smallest currency unit' })
  grossRevenueMinor!: number;

  @ApiProperty({ description: 'Smallest currency unit' })
  refundedRevenueMinor!: number;

  @ApiProperty({ description: 'Gross minus refunded, smallest currency unit' })
  netRevenueMinor!: number;
}

export class PortfolioSummaryDto {
  @ApiProperty()
  eventsPublished!: number;

  @ApiProperty()
  eventsCancelled!: number;

  @ApiProperty()
  ticketsCheckedIn!: number;

  @ApiProperty()
  ticketsRevoked!: number;

  @ApiProperty({ type: [CurrencyTotalsDto] })
  revenue!: CurrencyTotalsDto[];
}
