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

const PUBLISHED_EVENT_READ_RULES = {
  routeKey: 'published-event-read',
  tokenBucket: {
    capacity: 120,
    name: 'ip-burst',
    refillIntervalMs: 500,
  },
  primarySlidingWindow: {
    limit: 3_600,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 3_600,
    name: 'unused',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

interface PublishedEventRequest {
  ip?: string;
  socket: { remoteAddress?: string };
}

interface PublishedEventResponse {
  setHeader(name: string, value: string): void;
}

export class PublishedEventRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(clientIp: string): Promise<RateLimitDecision> {
    const rules = PUBLISHED_EVENT_READ_RULES;
    const keyPrefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ipSubject = createHmac('sha256', this.keySecret)
      .update(`ip:${clientIp}`)
      .digest('hex');

    return this.state.consume({
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    });
  }
}

@Injectable()
export class PublishedEventReadRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: PublishedEventRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<PublishedEventRequest>();
    const response = http.getResponse<PublishedEventResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';

    try {
      const decision = await this.rateLimits.check(clientIp);
      this.setHeaders(response, decision);
      if (decision.allowed) return true;

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'EVENT_READ_RATE_LIMITED',
        'Wait before requesting more event details.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'EVENT_SERVICE_UNAVAILABLE',
          'Event details are temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }
      throw error;
    }
  }

  private setHeaders(
    response: PublishedEventResponse,
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
