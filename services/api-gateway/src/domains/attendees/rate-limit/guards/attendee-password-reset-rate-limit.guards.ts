import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../../http/errors/api-http.exception';
import { RateLimitStateUnavailableError } from '../../../../rate-limit/errors/rate-limit.errors';
import type { RateLimitDecision } from '../../../../rate-limit/types/rate-limit.types';
import {
  AttendeePasswordResetRateLimitService,
  type AttendeePasswordResetOperation,
} from '../services/attendee-password-reset-rate-limit.service';

interface PasswordResetRequest {
  body: unknown;
  ip?: string;
  socket: { remoteAddress?: string };
}

interface RateLimitResponse {
  setHeader(name: string, value: string): void;
}

function readEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('email' in body)) {
    return undefined;
  }

  const email = Reflect.get(body, 'email');
  return typeof email === 'string' && email.trim() !== '' ? email : undefined;
}

function setRateLimitHeaders(
  response: RateLimitResponse,
  decision: RateLimitDecision,
): void {
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
}

abstract class AttendeePasswordResetRateLimitGuard implements CanActivate {
  protected abstract readonly operation: AttendeePasswordResetOperation;

  constructor(
    private readonly rateLimits: AttendeePasswordResetRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<PasswordResetRequest>();
    const response = http.getResponse<RateLimitResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const email = readEmail(request.body);

    try {
      const decision = await this.rateLimits.check(
        this.operation,
        email === undefined ? { clientIp } : { clientIp, email },
      );
      setRateLimitHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        this.operation === 'forgot'
          ? 'FORGOT_PASSWORD_RATE_LIMITED'
          : 'RESET_PASSWORD_RATE_LIMITED',
        this.operation === 'forgot'
          ? 'Wait before requesting another password reset email.'
          : 'Wait before trying another password reset code.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'PASSWORD_RESET_UNAVAILABLE',
          'Password reset is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }
}

@Injectable()
export class AttendeeForgotPasswordRateLimitGuard extends AttendeePasswordResetRateLimitGuard {
  protected readonly operation = 'forgot' as const;

  constructor(rateLimits: AttendeePasswordResetRateLimitService) {
    super(rateLimits);
  }
}

@Injectable()
export class AttendeeResetPasswordRateLimitGuard extends AttendeePasswordResetRateLimitGuard {
  protected readonly operation = 'reset' as const;

  constructor(rateLimits: AttendeePasswordResetRateLimitService) {
    super(rateLimits);
  }
}
