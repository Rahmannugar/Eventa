import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../../http/errors/api-http.exception';
import { RateLimitStateUnavailableError } from '../../../../rate-limit/errors/rate-limit.errors';
import type { RateLimitDecision } from '../../../../rate-limit/types/rate-limit.types';
import { AttendeeSessionCookie } from '../../services/attendee-session-cookie.service';
import { AttendeeSessionRateLimitService } from '../services/attendee-session-rate-limit.service';

interface SessionRequest {
  headers: { cookie?: string };
  ip?: string;
  socket: { remoteAddress?: string };
}

interface SessionResponse {
  setHeader(name: string, value: string): void;
}

type SessionOperation = 'account' | 'logout';

function setHeaders(
  response: SessionResponse,
  decision: RateLimitDecision,
): void {
  response.setHeader(
    'RateLimit-Policy',
    decision.limits
      .map(
        (limit) => `"${limit.name}";q=${limit.quota};w=${limit.windowSeconds}`,
      )
      .join(', '),
  );
  response.setHeader(
    'RateLimit',
    decision.limits
      .map(
        (limit) =>
          `"${limit.name}";r=${limit.remaining};t=${limit.resetAfterSeconds}`,
      )
      .join(', '),
  );
}

abstract class AttendeeSessionRateLimitGuard implements CanActivate {
  protected abstract readonly operation: SessionOperation;

  constructor(
    private readonly rateLimits: AttendeeSessionRateLimitService,
    private readonly sessionCookie: AttendeeSessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<SessionRequest>();
    const response = http.getResponse<SessionResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const sessionToken = this.sessionCookie.read(request.headers.cookie);

    try {
      const decision = await this.rateLimits.check(
        this.operation,
        sessionToken === undefined ? { clientIp } : { clientIp, sessionToken },
      );
      setHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        this.operation === 'account'
          ? 'ACCOUNT_RATE_LIMITED'
          : 'LOGOUT_RATE_LIMITED',
        this.operation === 'account'
          ? 'Wait before requesting your account again.'
          : 'Wait before trying to sign out again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'AUTHENTICATION_UNAVAILABLE',
          'Authentication is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }
}

@Injectable()
export class AttendeeAccountRateLimitGuard extends AttendeeSessionRateLimitGuard {
  protected readonly operation = 'account' as const;

  constructor(
    rateLimits: AttendeeSessionRateLimitService,
    sessionCookie: AttendeeSessionCookie,
  ) {
    super(rateLimits, sessionCookie);
  }
}

@Injectable()
export class AttendeeLogoutRateLimitGuard extends AttendeeSessionRateLimitGuard {
  protected readonly operation = 'logout' as const;

  constructor(
    rateLimits: AttendeeSessionRateLimitService,
    sessionCookie: AttendeeSessionCookie,
  ) {
    super(rateLimits, sessionCookie);
  }
}
