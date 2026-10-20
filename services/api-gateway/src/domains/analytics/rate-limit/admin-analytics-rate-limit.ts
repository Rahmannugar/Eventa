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
import { AdminSessionCookie } from '../../admins/services/admin-session-cookie.service';

// A reporting read answers from Analytics's own projection, so it is metered
// like the admin event reads rather than like a mutation.
const READ_RULES = {
  routeKey: 'admin-analytics-read',
  tokenBucket: {
    capacity: 60,
    name: 'ip-burst',
    refillIntervalMs: 1_000,
  },
  primarySlidingWindow: {
    limit: 1_800,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 1_200,
    name: 'session-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

interface AnalyticsRequest {
  headers: { cookie?: string };
  ip?: string;
  socket: { remoteAddress?: string };
}

interface AnalyticsResponse {
  setHeader(name: string, value: string): void;
}

export class AdminAnalyticsRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(clientIp: string, sessionToken?: string): Promise<RateLimitDecision> {
    const keyPrefix = `eventa:rate-limit:{${READ_RULES.routeKey}}`;
    const ipSubject = this.hash(`ip:${clientIp}`);
    const attempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules: READ_RULES,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    };

    return this.state.consume(
      sessionToken === undefined
        ? attempt
        : {
            ...attempt,
            secondarySlidingWindowKey: `${keyPrefix}:window:session:${this.hash(`session:${sessionToken}`)}`,
          },
    );
  }

  private hash(value: string): string {
    return createHmac('sha256', this.keySecret).update(value).digest('hex');
  }
}

@Injectable()
export class AdminAnalyticsReadRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimits: AdminAnalyticsRateLimitService,
    private readonly sessionCookie: AdminSessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AnalyticsRequest>();
    const response = http.getResponse<AnalyticsResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';

    try {
      const decision = await this.rateLimits.check(
        clientIp,
        this.sessionCookie.read(request.headers.cookie),
      );
      this.setHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'ANALYTICS_READ_RATE_LIMITED',
        'Wait before loading analytics again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ANALYTICS_SERVICE_UNAVAILABLE',
          'Analytics are temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }

  private setHeaders(
    response: AnalyticsResponse,
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
