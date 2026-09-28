import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import { AttendeeAuthenticationGuard } from '../../attendees/guards/attendee-authentication.guard';
import {
  SearchEventsDto,
  SearchEventsQueryDto,
} from '../dto/discovery-search.dto';
import { EventSearchRateLimitGuard } from '../rate-limit/discovery-search-rate-limit';
import { DiscoverySearchService } from '../services/discovery-search.service';

@ApiTags('Events')
@ApiCookieAuth('attendeeSession')
@Controller('search')
export class DiscoverySearchController {
  constructor(private readonly discovery: DiscoverySearchService) {}

  @Get('events')
  @UseGuards(EventSearchRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiOperation({ summary: 'Search published events' })
  @ApiOkResponse({ type: SearchEventsDto })
  search(
    @Query() query: SearchEventsQueryDto,
    @RequestId() requestId: string,
  ): Promise<SearchEventsDto> {
    return this.discovery.search(query, requestId);
  }
}
