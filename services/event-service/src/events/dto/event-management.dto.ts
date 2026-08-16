import type {
  CreateDraftEventRequest,
  GetAdminEventRequest,
  ListAdminEventsRequest,
  PublishEventRequest,
  RetireDraftEventRequest,
  UpdateDraftEventRequest,
  Venue,
} from '@eventa/grpc-contracts';
import { AdminEventSort } from '@eventa/grpc-contracts';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsDefined,
  IsEnum,
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
  ValidateIf,
} from 'class-validator';

export class GetAdminEventDto implements GetAdminEventRequest {
  @IsUUID()
  eventId!: string;
}

export class ListAdminEventsDto implements ListAdminEventsRequest {
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize!: number;

  @ValidateIf(
    (venue: EventVenueDto) =>
      venue.region !== undefined || venue.regionCode !== undefined,
  )
  @IsString()
  @MaxLength(512)
  pageToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,7}$/)
  regionCode?: string;

  @IsEnum(AdminEventSort)
  sort!: AdminEventSort;
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
  addressLineOne!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLineTwo?: string;

  @IsOptional()
  @IsString()
  addressLine1!: string;

  @IsOptional()
  @IsString()
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
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,7}$/)
  regionCode?: string;

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

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  description!: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique((category: string) => category.trim().toLocaleLowerCase('en'))
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  categories!: string[];

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
  venue!: EventVenueDto | undefined;
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

  @IsString()
  @MaxLength(80)
  category!: string;

  @ArrayMaxSize(5)
  @ArrayUnique((category: string) => category.trim().toLocaleLowerCase('en'))
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  categories!: string[];

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
  venue!: EventVenueDto | undefined;
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

export class RetireDraftEventDto implements RetireDraftEventRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;
}
