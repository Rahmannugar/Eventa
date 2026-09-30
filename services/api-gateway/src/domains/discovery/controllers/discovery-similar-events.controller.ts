import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import {
  SimilarEventsDto,
  SimilarEventsPathDto,
  SimilarEventsQueryDto,
} from '../dto/discovery-similar.dto';
import { SimilarEventsRateLimitGuard } from '../rate-limit/discovery-similar-events-rate-limit';
import { DiscoverySimilarEventsService } from '../services/discovery-similar.service';

@ApiTags('Events')
@Controller('events/:eventId/similar')
export class DiscoverySimilarEventsController {
  constructor(private readonly discovery: DiscoverySimilarEventsService) {}

  @Get()
  @UseGuards(SimilarEventsRateLimitGuard)
  @ApiOperation({ summary: 'List events similar to one event' })
  @ApiOkResponse({ type: SimilarEventsDto })
  similar(
    @Param() path: SimilarEventsPathDto,
    @Query() query: SimilarEventsQueryDto,
    @RequestId() requestId: string,
  ): Promise<SimilarEventsDto> {
    return this.discovery.similar(path.eventId, query, requestId);
  }
}
