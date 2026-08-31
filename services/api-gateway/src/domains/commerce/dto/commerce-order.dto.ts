import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class StartCheckoutDto {
  @IsUUID()
  eventId!: string;
  @IsUUID()
  ticketTypeId!: string;
  @IsUUID()
  idempotencyKey!: string;
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

export class CheckoutOrderPathDto {
  @IsUUID()
  orderId!: string;
}

export class CheckoutOrderDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() ticketTypeId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() currency?: string;
  @ApiPropertyOptional() totalMinor?: number;
  @ApiPropertyOptional() reservationExpiresAt?: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class CheckoutPaymentDto {
  @ApiProperty() paymentId!: string;
  @ApiProperty() clientSecret!: string;
}

export class CheckoutStartDto extends CheckoutOrderDto {
  @ApiProperty({ type: CheckoutPaymentDto })
  payment!: CheckoutPaymentDto;
}
