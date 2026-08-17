import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AdminEventPathDto {
  @IsUUID()
  eventId!: string;
}

export class AdminEventTicketTypePathDto extends AdminEventPathDto {
  @IsUUID()
  ticketTypeId!: string;
}

export class AdminEventListQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 50, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ description: 'Opaque pagination cursor' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ example: 'NG' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiPropertyOptional({ example: 'LA' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,7}$/)
  regionCode?: string;

  @ApiPropertyOptional({
    default: 'updated_desc',
    enum: ['updated_desc', 'event_date_asc', 'event_date_desc'],
  })
  @IsIn(['updated_desc', 'event_date_asc', 'event_date_desc'])
  sort: 'updated_desc' | 'event_date_asc' | 'event_date_desc' = 'updated_desc';
}

export class AdminEventMediaUploadPathDto extends AdminEventPathDto {
  @IsUUID()
  uploadId!: string;
}

export class AdminEventMediaPathDto extends AdminEventPathDto {
  @ApiProperty({
    enum: ['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'],
  })
  @IsString()
  @IsIn(['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'])
  slot!: 'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';
}

export class EventVenueDto {
  @ApiProperty({ example: 'Landmark Centre', maxLength: 160 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'Water Corporation Drive', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine1!: string;

  @ApiPropertyOptional({ example: 'Victoria Island', maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine2?: string;

  @ApiProperty({ example: 'Lagos', maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @ApiPropertyOptional({ example: 'Lagos', maxLength: 120 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  region?: string;

  @ApiPropertyOptional({ example: 'LA', maxLength: 8 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,7}$/)
  regionCode?: string;

  @ApiPropertyOptional({ example: '101241', maxLength: 32 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  postalCode?: string;

  @ApiProperty({ example: 'NG', minLength: 2, maxLength: 2 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;
}

export class CreateDraftEventDto {
  @ApiProperty({ example: 'Lagos Design Week', maxLength: 160 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ maxLength: 10000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  description!: string;

  @ApiProperty({ example: ['Outdoors', 'Sports'], maxItems: 5 })
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique((category: string) => category.trim().toLocaleLowerCase('en'))
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  categories!: string[];

  @ApiProperty({ example: '2026-10-15T09:00:00+01:00' })
  @IsISO8601({ strict: true, strictSeparator: true })
  startsAt!: string;

  @ApiProperty({ example: '2026-10-15T18:00:00+01:00' })
  @IsISO8601({ strict: true, strictSeparator: true })
  endsAt!: string;

  @ApiProperty({ example: 'Africa/Lagos', maxLength: 64 })
  @IsTimeZone()
  @MaxLength(64)
  timeZone!: string;

  @ApiProperty({ type: EventVenueDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => EventVenueDto)
  venue!: EventVenueDto;
}

export class UpdateDraftEventDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @ApiProperty({ example: 'Lagos Design Week', maxLength: 160 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ maxLength: 10000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  description!: string;

  @ApiProperty({ example: ['Outdoors', 'Sports'], maxItems: 5 })
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique((category: string) => category.trim().toLocaleLowerCase('en'))
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  categories!: string[];

  @ApiProperty({ example: '2026-10-15T09:00:00+01:00' })
  @IsISO8601({ strict: true, strictSeparator: true })
  startsAt!: string;

  @ApiProperty({ example: '2026-10-15T18:00:00+01:00' })
  @IsISO8601({ strict: true, strictSeparator: true })
  endsAt!: string;

  @ApiProperty({ example: 'Africa/Lagos', maxLength: 64 })
  @IsTimeZone()
  @MaxLength(64)
  timeZone!: string;

  @ApiProperty({ type: EventVenueDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => EventVenueDto)
  venue!: EventVenueDto;
}

export class AdminEventDto {
  @ApiProperty({ example: '8b3856cc-040d-4584-a952-412028d2b600' })
  eventId!: string;

  @ApiProperty({ example: 'Lagos Design Week' })
  title!: string;

  @ApiPropertyOptional()
  description!: string | undefined;

  @ApiProperty({ example: ['Design'], maxItems: 5 })
  categories!: string[];

  @ApiPropertyOptional({ example: '2026-10-15T08:00:00.000Z' })
  startsAt!: string | undefined;

  @ApiPropertyOptional({ example: '2026-10-15T17:00:00.000Z' })
  endsAt!: string | undefined;

  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  timeZone!: string | undefined;

  @ApiPropertyOptional({ type: EventVenueDto })
  venue!: EventVenueDto | undefined;

  @ApiProperty({ type: () => [AdminEventMediaDto] })
  media!: AdminEventMediaDto[];

  @ApiProperty({ enum: ['draft', 'published'], example: 'draft' })
  status!: 'draft' | 'published';

  @ApiProperty({ example: 1, minimum: 1 })
  version!: number;

  @ApiProperty({ example: '81c30c75-d16b-469b-a7c5-20e8973f1b9a' })
  createdByAdminId!: string;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  updatedAt!: string;

  @ApiPropertyOptional({ example: '2026-07-30T10:05:00.000Z' })
  publishedAt!: string | undefined;
}

export class AdminEventSummaryDto {
  @ApiProperty({ example: '8b3856cc-040d-4584-a952-412028d2b600' })
  eventId!: string;

  @ApiProperty({ example: 'Lagos Design Week' })
  title!: string;

  @ApiProperty({ example: ['Outdoors', 'Sports'], maxItems: 5 })
  categories!: string[];

  @ApiProperty({ enum: ['draft', 'published'], example: 'draft' })
  status!: 'draft' | 'published';

  @ApiPropertyOptional({ example: '2026-10-15T08:00:00.000Z' })
  startsAt!: string | undefined;

  @ApiPropertyOptional({ example: '2026-10-15T17:00:00.000Z' })
  endsAt!: string | undefined;

  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  timeZone!: string | undefined;

  @ApiPropertyOptional({ type: EventVenueDto })
  venue!: EventVenueDto | undefined;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  updatedAt!: string;
}

export class AdminEventListDto {
  @ApiProperty({ type: () => [AdminEventSummaryDto] })
  events!: AdminEventSummaryDto[];

  @ApiPropertyOptional({ description: 'Opaque cursor for the next page' })
  nextCursor?: string;
}

export class PublishEventDto {
  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;
}

export class CreateEventTicketTypeDto {
  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @ApiProperty({ example: 'General admission', maxLength: 80 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ticketCurrencyId!: string;

  @ApiProperty({ example: 2500000, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  priceMinor!: number;

  @ApiProperty({ example: 500, maximum: 1000000, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  capacity!: number;

  @ApiProperty({ example: '2026-08-20T09:00:00+01:00' })
  @IsISO8601({ strict: true, strictSeparator: true })
  salesStartAt!: string;

  @ApiProperty({ example: '2026-10-14T23:59:00+01:00' })
  @IsISO8601({ strict: true, strictSeparator: true })
  salesEndAt!: string;
}

export class EventTicketTypeDto {
  @ApiProperty()
  ticketTypeId!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  ticketCurrencyId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description!: string | undefined;

  @ApiProperty()
  priceMinor!: number;

  @ApiProperty()
  capacity!: number;

  @ApiProperty()
  reservedQuantity!: number;

  @ApiProperty()
  soldQuantity!: number;

  @ApiProperty()
  availableQuantity!: number;

  @ApiProperty()
  salesStartAt!: string;

  @ApiProperty()
  salesEndAt!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DefineEventTicketCurrencyDto {
  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @ApiProperty({ example: 'NGN', minLength: 3, maxLength: 3 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class EventTicketCurrencyDto {
  @ApiProperty()
  ticketCurrencyId!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DefineEventTicketCurrencyResponseDto {
  @ApiProperty()
  eventVersion!: number;

  @ApiProperty({ type: EventTicketCurrencyDto })
  ticketCurrency!: EventTicketCurrencyDto;
}

export class CreateEventTicketTypeResponseDto {
  @ApiProperty()
  eventVersion!: number;

  @ApiProperty({ type: EventTicketTypeDto })
  ticketType!: EventTicketTypeDto;
}

export class UpdateEventTicketTypeDto extends OmitType(
  CreateEventTicketTypeDto,
  ['ticketCurrencyId'] as const,
) {}

export class UpdateEventTicketTypeResponseDto extends CreateEventTicketTypeResponseDto {}

export class RetireEventTicketTypeQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;
}

export class RetireEventTicketTypeResponseDto {
  @ApiProperty()
  eventVersion!: number;
}

export class EventTicketTypeListDto {
  @ApiProperty({ type: () => [EventTicketCurrencyDto] })
  ticketCurrencies!: EventTicketCurrencyDto[];

  @ApiProperty()
  eventVersion!: number;

  @ApiProperty({ type: () => [EventTicketTypeDto] })
  ticketTypes!: EventTicketTypeDto[];
}

export class CreateEventMediaUploadDto {
  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @ApiProperty({
    enum: ['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'],
  })
  @IsString()
  @IsIn(['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'])
  slot!: 'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';

  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @ApiProperty({ minimum: 1, maximum: 8388608 })
  @IsInt()
  @Min(1)
  @Max(8_388_608)
  sizeBytes!: number;
}

export class EventMediaUploadIntentDto {
  @ApiProperty()
  uploadId!: string;

  @ApiProperty()
  uploadUrl!: string;

  @ApiProperty({ additionalProperties: { type: 'string' }, type: 'object' })
  requiredHeaders!: Record<string, string>;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  verificationDeadlineAt!: string;
}

export class EventMediaUploadStatusDto {
  @ApiProperty()
  uploadId!: string;

  @ApiProperty({
    enum: ['pending', 'attached', 'rejected', 'conflict', 'expired'],
  })
  status!: 'pending' | 'attached' | 'rejected' | 'conflict' | 'expired';

  @ApiProperty({
    enum: ['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'],
  })
  slot!: 'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  verificationDeadlineAt!: string;

  @ApiPropertyOptional()
  attachedEventVersion?: number;

  @ApiPropertyOptional()
  failureCode?: string;
}

export class RemoveEventMediaQueryDto {
  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;
}

export class RemoveEventMediaResponseDto {
  @ApiProperty({ example: 3, minimum: 2 })
  eventVersion!: number;
}

export class RetireDraftEventQueryDto {
  @ApiProperty({ example: 3, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;
}

export class RetireDraftEventResponseDto {
  @ApiProperty({ example: 4, minimum: 2 })
  eventVersion!: number;
}

export class AdminEventMediaDto {
  @ApiProperty()
  mediaId!: string;

  @ApiProperty({
    enum: ['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'],
  })
  slot!: 'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';

  @ApiProperty()
  url!: string;

  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;
}
