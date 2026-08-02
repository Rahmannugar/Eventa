import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateDraftEventDto {
  @ApiProperty({ example: 'Lagos Design Week', maxLength: 160 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;
}

export class AdminEventPathDto {
  @IsUUID()
  eventId!: string;
}

export class AdminEventMediaUploadPathDto extends AdminEventPathDto {
  @IsUUID()
  uploadId!: string;
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

  @ApiProperty({ example: 'Design', maxLength: 80 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

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

  @ApiPropertyOptional({ example: 'Design' })
  category!: string | undefined;

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

  @ApiProperty({ enum: ['draft'], example: 'draft' })
  status!: 'draft';

  @ApiProperty({ example: 1, minimum: 1 })
  version!: number;

  @ApiProperty({ example: '81c30c75-d16b-469b-a7c5-20e8973f1b9a' })
  createdByAdminId!: string;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  updatedAt!: string;
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
