import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

import { SearchEventResultDto } from './discovery-search.dto';

export class RecommendEventsQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}

export class RecommendedEventsDto {
  @ApiProperty({ type: [SearchEventResultDto] })
  events!: SearchEventResultDto[];
}
