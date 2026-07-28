import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  LoggedInAttendeeDto,
  LoginAttendeeDto,
} from '../dto/login-attendee.dto';
import { AttendeeLoginService } from '../services/attendee-login.service';
import { AttendeeLoginRateLimitGuard } from '../rate-limit/guards/attendee-login-rate-limit.guard';
import { ApiLoginAttendee } from '../docs/attendee-login.docs';
import {
  AttendeeSessionCookie,
  type AttendeeCookieResponse,
} from '../services/attendee-session-cookie.service';
import { AttendeeClientOriginGuard } from '../guards/attendee-client-origin.guard';

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeeLoginController {
  constructor(
    private readonly attendeeLogin: AttendeeLoginService,
    private readonly sessionCookie: AttendeeSessionCookie,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AttendeeClientOriginGuard, AttendeeLoginRateLimitGuard)
  @ApiLoginAttendee()
  async login(
    @Body() request: LoginAttendeeDto,
    @Headers('x-request-id') requestId: string,
    @Res({ passthrough: true }) response: AttendeeCookieResponse,
  ): Promise<LoggedInAttendeeDto> {
    const result = await this.attendeeLogin.login({
      email: request.email,
      password: request.password,
      requestId,
    });

    this.sessionCookie.set(
      response,
      result.sessionToken,
      result.sessionExpiresAt,
    );

    return {
      attendeeId: result.attendeeId,
      email: result.email,
      emailVerified: true,
      status: 'active',
      username: result.username,
    };
  }
}
