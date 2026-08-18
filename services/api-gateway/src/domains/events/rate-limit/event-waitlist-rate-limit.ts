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

type Operation = 'read' | 'mutation';

const RULES: Record<Operation, HybridRateLimitRules> = {
  read: {
    routeKey: 'event-waitlist-read',
    tokenBucket: { capacity: 60, name: 'ip-burst', refillIntervalMs: 1_000 },
    primarySlidingWindow: {
      limit: 1_200,
      name: 'ip-hour',
      windowMs: 3_600_000,
    },
    secondarySlidingWindow: {
      limit: 600,
      name: 'session-hour',
      windowMs: 3_600_000,
    },
  },
  mutation: {
    routeKey: 'event-waitlist-mutation',
    tokenBucket: { capacity: 10, name: 'ip-burst', refillIntervalMs: 6_000 },
    primarySlidingWindow: { limit: 120, name: 'ip-hour', windowMs: 3_600_000 },
    secondarySlidingWindow: {
      limit: 60,
      name: 'session-hour',
      windowMs: 3_600_000,
    },
  },
};

export class EventWaitlistRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly secret: string,
  ) {}

  check(
    operation: Operation,
    clientIp: string,
    sessionToken?: string,
  ): Promise<RateLimitDecision> {
    const rules = RULES[operation];
    const prefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const hash = (value: string) =>
      createHmac('sha256', this.secret).update(value).digest('hex');
    return this.state.consume({
      member: randomUUID(),
      primarySlidingWindowKey: `${prefix}:window:ip:${hash(`ip:${clientIp}`)}`,
      ...(sessionToken === undefined
        ? {}
        : {
            secondarySlidingWindowKey: `${prefix}:window:session:${hash(`session:${sessionToken}`)}`,
          }),
      rules,
      tokenBucketKey: `${prefix}:bucket:ip:${hash(`ip:${clientIp}`)}`,
    });
  }
}

@Injectable()
export class EventWaitlistRateLimitGuard implements CanActivate {
  constructor(
    private readonly limits: EventWaitlistRateLimitService,
    private readonly cookie: AttendeeSessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method: string;
      headers: { cookie?: string };
      ip?: string;
      socket: { remoteAddress?: string };
    }>();
    const response = http.getResponse<{
      setHeader(name: string, value: string): void;
    }>();
    try {
      const decision = await this.limits.check(
        request.method === 'GET' ? 'read' : 'mutation',
        request.ip || request.socket.remoteAddress || 'unknown',
        this.cookie.read(request.headers.cookie),
      );
      this.headers(response, decision);
      if (decision.allowed) return true;
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'WAITLIST_RATE_LIMITED',
        'Wait before trying the waitlist again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError)
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'EVENT_SERVICE_UNAVAILABLE',
          'The waitlist is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
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
