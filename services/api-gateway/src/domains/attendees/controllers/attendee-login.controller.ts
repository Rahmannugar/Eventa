import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
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
import { ATTENDEE_SESSION_COOKIE_SECURE } from '../constants/attendee-login.constants';
import { ApiLoginAttendee } from '../docs/attendee-login.docs';

const SESSION_COOKIE = 'eventa_attendee_session';

interface CookieResponse {
  cookie(
    name: string,
    value: string,
    options: {
      expires: Date;
      httpOnly: boolean;
      path: string;
      sameSite: 'lax';
      secure: boolean;
    },
  ): void;
}

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeeLoginController {
  constructor(
    private readonly attendeeLogin: AttendeeLoginService,
    @Inject(ATTENDEE_SESSION_COOKIE_SECURE)
    private readonly secureCookie: boolean,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AttendeeLoginRateLimitGuard)
  @ApiLoginAttendee()
  async login(
    @Body() request: LoginAttendeeDto,
    @Headers('x-request-id') requestId: string,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<LoggedInAttendeeDto> {
    const result = await this.attendeeLogin.login({
      email: request.email,
      password: request.password,
      requestId,
    });

    response.cookie(SESSION_COOKIE, result.sessionToken, {
      expires: new Date(result.sessionExpiresAt),
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.secureCookie,
    });

    return {
      attendeeId: result.attendeeId,
      email: result.email,
      emailVerified: true,
      status: 'active',
      username: result.username,
    };
  }
}
