import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class SearchEventsQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text words matched against title and description',
    maxLength: 200,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @ApiPropertyOptional({
    description: 'Exact categories, as a comma-separated list',
    example: 'music,festival',
    type: [String],
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    }
    return Array.isArray(value) ? value : undefined;
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  categories?: string[];

  @ApiPropertyOptional({
    description: 'Earliest event start time, RFC 3339',
    example: '2026-10-01T00:00:00Z',
  })
  @IsOptional()
  @IsString()
  @Matches(RFC3339, { message: 'startsFrom must be an RFC 3339 timestamp' })
  startsFrom?: string;

  @ApiPropertyOptional({
    description: 'Latest event start time, RFC 3339',
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsString()
  @Matches(RFC3339, { message: 'startsTo must be an RFC 3339 timestamp' })
  startsTo?: string;

  @ApiPropertyOptional({ default: 20, maximum: 50, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  offset = 0;
}

export class SearchEventResultDto {
  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional()
  description?: string | undefined;

  @ApiPropertyOptional({ example: '2026-10-03T18:00:00Z' })
  startsAt?: string | undefined;

  @ApiPropertyOptional({ example: '2026-10-05T23:00:00Z' })
  endsAt?: string | undefined;

  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  timeZone?: string | undefined;

  @ApiProperty({ type: [String] })
  categories!: string[];

  @ApiPropertyOptional()
  venueName?: string | undefined;

  @ApiPropertyOptional()
  venueCity?: string | undefined;

  @ApiPropertyOptional({ example: 'NG' })
  venueCountryCode?: string | undefined;
}

export class SearchEventsDto {
  @ApiProperty({ type: [SearchEventResultDto] })
  events!: SearchEventResultDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}
