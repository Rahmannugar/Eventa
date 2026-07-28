import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import { AdminSessionCookie } from '../services/admin-session-cookie.service';
import { AdminSessionService } from '../services/admin-session.service';
import type { AdminAuthenticatedRequest } from '../types/authenticated-admin.types';

@Injectable()
export class AdminAuthenticationGuard implements CanActivate {
  constructor(
    private readonly sessionCookie: AdminSessionCookie,
    private readonly adminSessions: AdminSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const token = this.sessionCookie.read(request.headers.cookie);

    if (token === undefined) {
      throw new ApiHttpException(
        HttpStatus.UNAUTHORIZED,
        'ADMIN_SESSION_INVALID',
        'Sign in to continue.',
      );
    }

    request.adminSession = await this.adminSessions.authenticate(
      token,
      request.headers['x-request-id'],
    );
    return true;
  }
}
