import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../../http/errors/api-http.exception';
import { RateLimitStateUnavailableError } from '../../../../rate-limit/errors/rate-limit.errors';
import { AttendeeLoginRateLimitService } from '../services/attendee-login-rate-limit.service';

interface LoginRequest {
  body: unknown;
  ip?: string;
  socket: { remoteAddress?: string };
}

interface LoginResponse {
  setHeader(name: string, value: string): void;
}

function readEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('email' in body)) {
    return undefined;
  }

  const email = Reflect.get(body, 'email');
  return typeof email === 'string' && email.trim() !== '' ? email : undefined;
}

@Injectable()
export class AttendeeLoginRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: AttendeeLoginRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<LoginRequest>();
    const response = http.getResponse<LoginResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const email = readEmail(request.body);

    try {
      const decision = await this.rateLimits.check(
        email === undefined ? { clientIp } : { clientIp, email },
      );
      response.setHeader(
        'RateLimit-Policy',
        decision.limits
          .map(
            (limit) =>
              `"${limit.name}";q=${limit.quota};w=${limit.windowSeconds}`,
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

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'LOGIN_RATE_LIMITED',
        'Wait before trying to sign in again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'AUTHENTICATION_UNAVAILABLE',
          'Sign in is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }
}
