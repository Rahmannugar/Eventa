import {
  EventMediaSlot,
  type CreateEventMediaUploadRequest,
  type CreateDraftEventRequest,
  type GetEventMediaUploadRequest,
  type GetAdminEventRequest,
  type RemoveEventMediaRequest,
  type PublishEventRequest,
  type UpdateDraftEventRequest,
  type Venue,
} from '@eventa/grpc-contracts';
import { Transform, Type } from 'class-transformer';
import {
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

import { EVENT_MEDIA_CONTENT_TYPES } from '../constants/event-media.constants';

export class CreateDraftEventDto implements CreateDraftEventRequest {
  @IsUUID()
  adminId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;
}

export class GetAdminEventDto implements GetAdminEventRequest {
  @IsUUID()
  eventId!: string;
}

export class EventVenueDto implements Venue {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine1!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine2?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  region?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  postalCode?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;
}

export class UpdateDraftEventDto implements UpdateDraftEventRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  description!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  startsAt!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  endsAt!: string;

  @IsTimeZone()
  @MaxLength(64)
  timeZone!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => EventVenueDto)
  venue!: EventVenueDto;
}

export class CreateEventMediaUploadDto implements CreateEventMediaUploadRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @IsInt()
  @IsIn([1, 2, 3, 4, 5])
  slot!: EventMediaSlot;

  @IsString()
  @IsIn(EVENT_MEDIA_CONTENT_TYPES)
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @IsInt()
  @Min(1)
  @Max(8_388_608)
  sizeBytes!: number;
}

export class GetEventMediaUploadDto implements GetEventMediaUploadRequest {
  @IsUUID()
  eventId!: string;

  @IsUUID()
  uploadId!: string;
}

export class RemoveEventMediaDto implements RemoveEventMediaRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @IsInt()
  @IsIn([1, 2, 3, 4, 5])
  slot!: EventMediaSlot;
}

export class PublishEventDto implements PublishEventRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;
}
