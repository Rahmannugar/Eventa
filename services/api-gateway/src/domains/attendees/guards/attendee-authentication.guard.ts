import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import { AttendeeSessionCookie } from '../services/attendee-session-cookie.service';
import { AttendeeSessionService } from '../services/attendee-session.service';
import type { AttendeeAuthenticatedRequest } from '../types/authenticated-attendee.types';

@Injectable()
export class AttendeeAuthenticationGuard implements CanActivate {
  constructor(
    private readonly sessionCookie: AttendeeSessionCookie,
    private readonly attendeeSessions: AttendeeSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AttendeeAuthenticatedRequest>();
    const token = this.sessionCookie.read(request.headers.cookie);

    if (token === undefined) {
      throw new ApiHttpException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Sign in to continue.',
      );
    }

    request.attendeeSession = await this.attendeeSessions.authenticate(
      token,
      request.headers['x-request-id'],
    );
    return true;
  }
}
