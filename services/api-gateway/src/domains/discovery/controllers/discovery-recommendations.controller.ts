import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import { AttendeeAuthenticationGuard } from '../../attendees/guards/attendee-authentication.guard';
import type { AttendeeAuthenticatedRequest } from '../../attendees/types/authenticated-attendee.types';
import {
  RecommendEventsQueryDto,
  RecommendedEventsDto,
} from '../dto/discovery-recommendations.dto';
import { RecommendationsRateLimitGuard } from '../rate-limit/discovery-recommendations-rate-limit';
import { DiscoveryRecommendationsService } from '../services/discovery-recommendations.service';

@ApiTags('Recommendations')
@ApiCookieAuth('attendeeSession')
@Controller('attendees/me/recommendations')
export class DiscoveryRecommendationsController {
  constructor(private readonly discovery: DiscoveryRecommendationsService) {}

  @Get()
  @UseGuards(RecommendationsRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiOperation({ summary: 'Read recommended events for the signed-in attendee' })
  @ApiOkResponse({ type: RecommendedEventsDto })
  recommend(
    @Query() query: RecommendEventsQueryDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<RecommendedEventsDto> {
    return this.discovery.recommend(
      request.attendeeSession.attendeeId,
      query,
      requestId,
    );
  }
}
