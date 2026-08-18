import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AttendeeAuthenticationGuard } from '../../attendees/guards/attendee-authentication.guard';
import { AttendeeClientOriginGuard } from '../../attendees/guards/attendee-client-origin.guard';
import type { AttendeeAuthenticatedRequest } from '../../attendees/types/authenticated-attendee.types';
import { RequestId } from '../../../http/request-id.decorator';
import {
  EventWaitlistEntryDto,
  EventWaitlistPathDto,
  JoinEventWaitlistBodyDto,
} from '../dto/event-waitlist.dto';
import { EventWaitlistRateLimitGuard } from '../rate-limit/event-waitlist-rate-limit';
import { EventWaitlistService } from '../services/event-waitlist.service';

@ApiTags('Events')
@ApiCookieAuth('attendeeSession')
@Controller('events/:eventId/ticket-types/:ticketTypeId/waitlist')
export class EventWaitlistController {
  constructor(private readonly waitlist: EventWaitlistService) {}

  @Post()
  @UseGuards(
    AttendeeClientOriginGuard,
    EventWaitlistRateLimitGuard,
    AttendeeAuthenticationGuard,
  )
  @ApiOkResponse({ type: EventWaitlistEntryDto })
  join(
    @Param() path: EventWaitlistPathDto,
    @Body() body: JoinEventWaitlistBodyDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<EventWaitlistEntryDto> {
    return this.waitlist.join(
      path,
      request.attendeeSession.attendeeId,
      body.quantity,
      requestId,
    );
  }

  @Get()
  @UseGuards(EventWaitlistRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiOkResponse({ type: EventWaitlistEntryDto })
  get(
    @Param() path: EventWaitlistPathDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<EventWaitlistEntryDto> {
    return this.waitlist.get(
      path,
      request.attendeeSession.attendeeId,
      requestId,
    );
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(
    AttendeeClientOriginGuard,
    EventWaitlistRateLimitGuard,
    AttendeeAuthenticationGuard,
  )
  @ApiNoContentResponse()
  leave(
    @Param() path: EventWaitlistPathDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<void> {
    return this.waitlist.leave(
      path,
      request.attendeeSession.attendeeId,
      requestId,
    );
  }
}
