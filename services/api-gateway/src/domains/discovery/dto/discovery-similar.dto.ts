import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

import { SearchEventResultDto } from './discovery-search.dto';

export class SimilarEventsPathDto {
  @IsUUID()
  eventId!: string;
}

export class SimilarEventsQueryDto {
  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}

export class SimilarEventsDto {
  @ApiProperty({ type: [SearchEventResultDto] })
  events!: SearchEventResultDto[];
}
