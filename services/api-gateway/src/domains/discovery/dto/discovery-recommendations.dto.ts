import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { SearchEventResultDto } from './discovery-search.dto';

const TWO_NUMBERS = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;

export class RecommendEventsQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;

  @ApiPropertyOptional({
    description:
      'Blend proximity to a point into the ranking, as latitude,longitude',
    example: '6.5244,3.3792',
  })
  @IsOptional()
  @IsString()
  @Matches(TWO_NUMBERS, { message: 'origin must be latitude,longitude' })
  origin?: string;
}

export class RecommendedEventsDto {
  @ApiProperty({ type: [SearchEventResultDto] })
  events!: SearchEventResultDto[];
}
