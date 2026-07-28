import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AttendeeAuthenticationGuard } from '../guards/attendee-authentication.guard';
import { AttendeeClientOriginGuard } from '../guards/attendee-client-origin.guard';
import {
  AttendeeSessionCookie,
  type AttendeeCookieResponse,
} from '../services/attendee-session-cookie.service';
import { AttendeeSessionService } from '../services/attendee-session.service';
import type { AttendeeAuthenticatedRequest } from '../types/authenticated-attendee.types';
import { CurrentAttendeeAccountDto } from '../dto/current-attendee-account.dto';
import {
  AttendeeAccountRateLimitGuard,
  AttendeeDeletionRateLimitGuard,
  AttendeeLogoutRateLimitGuard,
} from '../rate-limit/guards/attendee-session-rate-limit.guards';
import {
  ApiGetCurrentAttendeeAccount,
  ApiDeleteAttendeeAccount,
  ApiLogoutAttendee,
} from '../docs/attendee-session.docs';
import { DeleteAttendeeAccountDto } from '../dto/delete-attendee-account.dto';

interface SessionRequest {
  headers: { cookie?: string };
}

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeeSessionController {
  constructor(
    private readonly sessions: AttendeeSessionService,
    private readonly sessionCookie: AttendeeSessionCookie,
  ) {}

  @Get('me')
  @UseGuards(AttendeeAccountRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiGetCurrentAttendeeAccount()
  me(
    @Req() request: AttendeeAuthenticatedRequest,
    @Headers('x-request-id') requestId: string,
  ): Promise<CurrentAttendeeAccountDto> {
    return this.sessions.getCurrentAccount(
      request.attendeeSession.attendeeId,
      requestId,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AttendeeClientOriginGuard, AttendeeLogoutRateLimitGuard)
  @ApiLogoutAttendee()
  async logout(
    @Req() request: SessionRequest,
    @Headers('x-request-id') requestId: string,
    @Res({ passthrough: true }) response: AttendeeCookieResponse,
  ): Promise<void> {
    const token = this.sessionCookie.read(request.headers.cookie);

    if (token !== undefined) {
      await this.sessions.logout(token, requestId);
    }

    this.sessionCookie.clear(response);
  }

  @Post('delete-account')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(
    AttendeeClientOriginGuard,
    AttendeeDeletionRateLimitGuard,
    AttendeeAuthenticationGuard,
  )
  @ApiDeleteAttendeeAccount()
  async deleteAccount(
    @Body() body: DeleteAttendeeAccountDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @Headers('x-request-id') requestId: string,
    @Res({ passthrough: true }) response: AttendeeCookieResponse,
  ): Promise<void> {
    await this.sessions.deleteAccount(
      request.attendeeSession.attendeeId,
      body.password,
      requestId,
    );
    this.sessionCookie.clear(response);
  }
}
