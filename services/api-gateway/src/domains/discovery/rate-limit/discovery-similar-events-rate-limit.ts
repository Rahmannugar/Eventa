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
import { AttendeeSessionCookie } from '../../attendees/services/attendee-session-cookie.service';

// A similar-events answer costs an embed, a similarity search, and a
// resolution call against Event Service, so it is metered like a
// recommendation rather than like an ordinary read.
const RULES = {
  routeKey: 'similar-events-read',
  tokenBucket: { capacity: 10, name: 'ip-burst', refillIntervalMs: 1_000 },
  primarySlidingWindow: {
    limit: 300,
    name: 'ip-hour',
    windowMs: 3_600_000,
  },
  secondarySlidingWindow: {
    limit: 300,
    name: 'session-hour',
    windowMs: 3_600_000,
  },
} as const satisfies HybridRateLimitRules;

export class SimilarEventsRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly secret: string,
  ) {}

  check(clientIp: string, sessionToken?: string): Promise<RateLimitDecision> {
    const prefix = `eventa:rate-limit:{${RULES.routeKey}}`;
    const hash = (value: string) =>
      createHmac('sha256', this.secret).update(value).digest('hex');
    return this.state.consume({
      member: randomUUID(),
      primarySlidingWindowKey: `${prefix}:window:ip:${hash(`ip:${clientIp}`)}`,
      ...(sessionToken === undefined
        ? {}
        : {
            secondarySlidingWindowKey: `${prefix}:window:session:${hash(
              `session:${sessionToken}`,
            )}`,
          }),
      rules: RULES,
      tokenBucketKey: `${prefix}:bucket:ip:${hash(`ip:${clientIp}`)}`,
    });
  }
}

@Injectable()
export class SimilarEventsRateLimitGuard implements CanActivate {
  constructor(
    private readonly limits: SimilarEventsRateLimitService,
    private readonly cookie: AttendeeSessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      headers: { cookie?: string };
      ip?: string;
      socket: { remoteAddress?: string };
    }>();
    const response = http.getResponse<{
      setHeader(name: string, value: string): void;
    }>();
    try {
      const decision = await this.limits.check(
        request.ip || request.socket.remoteAddress || 'unknown',
        this.cookie.read(request.headers.cookie),
      );
      this.headers(response, decision);
      if (decision.allowed) return true;
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'SIMILAR_EVENTS_RATE_LIMITED',
        'Wait before loading similar events again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'DISCOVERY_SERVICE_UNAVAILABLE',
          'Similar events are temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }
      throw error;
    }
  }

  private headers(
    response: { setHeader(name: string, value: string): void },
    decision: RateLimitDecision,
  ): void {
    response.setHeader(
      'RateLimit-Policy',
      decision.limits
        .map((item) => `"${item.name}";q=${item.quota};w=${item.windowSeconds}`)
        .join(', '),
    );
    response.setHeader(
      'RateLimit',
      decision.limits
        .map(
          (item) =>
            `"${item.name}";r=${item.remaining};t=${item.resetAfterSeconds}`,
        )
        .join(', '),
    );
  }
}
