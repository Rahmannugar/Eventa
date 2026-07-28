import { createHmac, randomUUID } from 'node:crypto';

import {
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import { RateLimitStateUnavailableError } from '../../../rate-limit/errors/rate-limit.errors';
import type { RateLimitState } from '../../../rate-limit/ports/rate-limit.state';
import type {
  HybridRateLimitRules,
  RateLimitDecision,
} from '../../../rate-limit/types/rate-limit.types';

const RULES = {
  routeKey: 'admin-registration',
  tokenBucket: {
    capacity: 5,
    name: 'ip-burst',
    refillIntervalMs: 12_000,
  },
  primarySlidingWindow: {
    limit: 30,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 5,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

interface RateLimitedRequest {
  body: unknown;
  ip?: string;
  socket: { remoteAddress?: string };
}

interface RateLimitResponse {
  setHeader(name: string, value: string): void;
}

export class AdminRegistrationRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(clientIp: string, email?: string): Promise<RateLimitDecision> {
    const keyPrefix = `eventa:rate-limit:{${RULES.routeKey}}`;
    const baseAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${this.hash(`ip:${clientIp}`)}`,
      rules: RULES,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${this.hash(`ip:${clientIp}`)}`,
    };
    const canonicalEmail = email?.trim().toLowerCase();

    return this.state.consume(
      canonicalEmail === undefined
        ? baseAttempt
        : {
            ...baseAttempt,
            secondarySlidingWindowKey: `${keyPrefix}:window:email:${this.hash(`email:${canonicalEmail}`)}`,
          },
    );
  }

  private hash(value: string): string {
    return createHmac('sha256', this.keySecret).update(value).digest('hex');
  }
}

@Injectable()
export class AdminRegistrationRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: AdminRegistrationRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitedRequest>();
    const response = http.getResponse<RateLimitResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const email = this.readEmail(request.body);

    try {
      const decision = await this.rateLimits.check(clientIp, email);
      this.setHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'ADMIN_REGISTRATION_RATE_LIMITED',
        'Wait before requesting another admin activation email.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ADMIN_REGISTRATION_UNAVAILABLE',
          'Admin registration is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }

  private readEmail(body: unknown): string | undefined {
    if (typeof body !== 'object' || body === null || !('email' in body)) {
      return undefined;
    }

    const email = Reflect.get(body, 'email');
    return typeof email === 'string' && email.trim() !== '' ? email : undefined;
  }

  private setHeaders(
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
}
