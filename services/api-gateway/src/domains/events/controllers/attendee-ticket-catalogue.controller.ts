import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import { AttendeeAuthenticationGuard } from '../../attendees/guards/attendee-authentication.guard';
import type { AttendeeAuthenticatedRequest } from '../../attendees/types/authenticated-attendee.types';
import {
  AttendeeTicketCatalogueDto,
  AttendeeTicketCataloguePathDto,
} from '../dto/attendee-ticket-catalogue.dto';
import { AttendeeTicketCatalogueRateLimitGuard } from '../rate-limit/attendee-ticket-catalogue-rate-limit';
import { AttendeeTicketCatalogueService } from '../services/attendee-ticket-catalogue.service';

@ApiTags('Events')
@ApiCookieAuth('attendeeSession')
@Controller('events/:eventId/ticket-options')
export class AttendeeTicketCatalogueController {
  constructor(private readonly catalogue: AttendeeTicketCatalogueService) {}

  @Get()
  @UseGuards(AttendeeTicketCatalogueRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiOkResponse({ type: AttendeeTicketCatalogueDto })
  get(
    @Param() path: AttendeeTicketCataloguePathDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<AttendeeTicketCatalogueDto> {
    return this.catalogue.get(
      path.eventId,
      request.attendeeSession.attendeeId,
      requestId,
    );
  }
}
