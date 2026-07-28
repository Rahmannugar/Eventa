import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import { ATTENDEE_CLIENT_ORIGIN } from '../constants/attendee-login.constants';

interface OriginRequest {
  headers: { origin?: string };
}

@Injectable()
export class AttendeeClientOriginGuard implements CanActivate {
  constructor(
    @Inject(ATTENDEE_CLIENT_ORIGIN)
    private readonly attendeeClientOrigin: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<OriginRequest>();

    if (request.headers.origin === this.attendeeClientOrigin) {
      return true;
    }

    throw new ApiHttpException(
      HttpStatus.FORBIDDEN,
      'UNTRUSTED_ORIGIN',
      'Request origin is not allowed.',
    );
  }
}
