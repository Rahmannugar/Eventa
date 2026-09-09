import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequestId } from '../../../http/request-id.decorator';
import { AttendeeAuthenticationGuard } from '../../attendees/guards/attendee-authentication.guard';
import type { AttendeeAuthenticatedRequest } from '../../attendees/types/authenticated-attendee.types';
import { AttendeeTicketsQueryDto, AttendeeTicketsDto } from '../dto/attendee-tickets.dto';
import { AttendeeTicketsService } from '../services/attendee-tickets.service';

@ApiTags('Tickets') @ApiCookieAuth('attendeeSession') @Controller('tickets')
export class AttendeeTicketsController {
  constructor(private readonly tickets: AttendeeTicketsService) {}

  @Get()
  @UseGuards(AttendeeAuthenticationGuard)
  @ApiOkResponse({ type: AttendeeTicketsDto })
  list(@Query() query: AttendeeTicketsQueryDto, @Req() request: AttendeeAuthenticatedRequest, @RequestId() requestId: string): Promise<AttendeeTicketsDto> {
    return this.tickets.list(request.attendeeSession.attendeeId, query, requestId);
  }
}
