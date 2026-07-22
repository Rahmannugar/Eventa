import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { RateLimitStoreUnavailableError } from '../../../../rate-limit/errors/rate-limit.errors';
import { AttendeeRegistrationRateLimitService } from '../services/attendee-registration-rate-limit.service';
import { ApiHttpException } from '../../../../http/errors/api-http.exception';

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

function setRateLimitHeaders(
  response: RateLimitResponse,
  decision: Awaited<ReturnType<AttendeeRegistrationRateLimitService['check']>>,
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

function readEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('email' in body)) {
    return undefined;
  }

  const email = Reflect.get(body, 'email');
  return typeof email === 'string' && email.trim() !== '' ? email : undefined;
}

@Injectable()
export class AttendeeRegistrationRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: AttendeeRegistrationRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitedRequest>();
    const response = http.getResponse<RateLimitResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const email = readEmail(request.body);

    try {
      const decision = await this.rateLimitService.check(
        email === undefined ? { clientIp } : { clientIp, email },
      );
      setRateLimitHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'REGISTRATION_RATE_LIMITED',
        'Wait before trying to register again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStoreUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'REGISTRATION_UNAVAILABLE',
          'Registration is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STORE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }
}
