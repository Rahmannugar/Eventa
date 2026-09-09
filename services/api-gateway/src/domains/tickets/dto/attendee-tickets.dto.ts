import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AttendeeTicketsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString()
  before?: string;
}

export class AttendeeTicketDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() ticketTypeId!: string;
  @ApiProperty() unitIndex!: number;
  @ApiProperty() status!: string;
  @ApiProperty() issuedAt!: string;
  @ApiProperty() qrToken!: string;
}

export class AttendeeTicketsDto {
  @ApiProperty({ type: () => [AttendeeTicketDto] }) tickets!: AttendeeTicketDto[];
  @ApiProperty() nextBefore!: string;
}
