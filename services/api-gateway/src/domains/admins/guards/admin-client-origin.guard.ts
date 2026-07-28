import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import { ADMIN_CLIENT_ORIGIN } from '../constants/admin-registration.constants';

interface OriginRequest {
  headers: { origin?: string };
}

@Injectable()
export class AdminClientOriginGuard implements CanActivate {
  constructor(
    @Inject(ADMIN_CLIENT_ORIGIN)
    private readonly adminClientOrigin: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<OriginRequest>();

    if (request.headers.origin === this.adminClientOrigin) {
      return true;
    }

    throw new ApiHttpException(
      HttpStatus.FORBIDDEN,
      'UNTRUSTED_ORIGIN',
      'Request origin is not allowed.',
    );
  }
}
