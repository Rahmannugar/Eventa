import type {
  CreateEventTicketTypeRequest,
  ListEventTicketTypesRequest,
} from '@eventa/grpc-contracts';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEventTicketTypeDto implements CreateEventTicketTypeRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  priceMinor!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  allocation!: number;

  @IsISO8601({ strict: true, strictSeparator: true })
  salesStartAt!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  salesEndAt!: string;
}

export class ListEventTicketTypesDto implements ListEventTicketTypesRequest {
  @IsUUID()
  eventId!: string;
}
