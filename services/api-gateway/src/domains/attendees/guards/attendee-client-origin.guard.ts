import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import { CLIENT_ORIGIN } from '../../../http/client-origin.constants';

interface OriginRequest {
  headers: { origin?: string };
}

@Injectable()
export class AttendeeClientOriginGuard implements CanActivate {
  constructor(
    @Inject(CLIENT_ORIGIN)
    private readonly clientOrigin: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<OriginRequest>();
    const origin = request.headers.origin;

    if (origin === undefined || origin === this.clientOrigin) {
      return true;
    }

    throw new ApiHttpException(
      HttpStatus.FORBIDDEN,
      'UNTRUSTED_ORIGIN',
      'Request origin is not allowed.',
    );
  }
}
