import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { RateLimitStateUnavailableError } from '../../../../rate-limit/errors/rate-limit.errors';
import { ApiHttpException } from '../../../../http/errors/api-http.exception';
import {
  AttendeeEmailVerificationRateLimitService,
  type AttendeeEmailVerificationOperation,
} from '../services/attendee-email-verification-rate-limit.service';

interface RateLimitedRequest {
  body: unknown;
  ip?: string;
  socket: {
    remoteAddress?: string;
  };
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

async function enforceRateLimit(
  context: ExecutionContext,
  service: AttendeeEmailVerificationRateLimitService,
  operation: AttendeeEmailVerificationOperation,
): Promise<boolean> {
  const http = context.switchToHttp();
  const request = http.getRequest<RateLimitedRequest>();
  const response = http.getResponse<RateLimitResponse>();
  const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
  const email = readEmail(request.body);

  try {
    const decision = await service.check(
      operation,
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
      `EMAIL_VERIFICATION_${operation.toUpperCase()}_RATE_LIMITED`,
      operation === 'confirm'
        ? 'Wait before trying another verification code.'
        : 'Wait before requesting another verification email.',
    );
  } catch (error: unknown) {
    if (error instanceof RateLimitStateUnavailableError) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'EMAIL_VERIFICATION_UNAVAILABLE',
        'Email verification is temporarily unavailable. Try again later.',
        { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
      );
    }

    throw error;
  }
}

@Injectable()
export class AttendeeEmailVerificationConfirmRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimits: AttendeeEmailVerificationRateLimitService,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    return enforceRateLimit(context, this.rateLimits, 'confirm');
  }
}

@Injectable()
export class AttendeeEmailVerificationResendRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimits: AttendeeEmailVerificationRateLimitService,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    return enforceRateLimit(context, this.rateLimits, 'resend');
  }
}
