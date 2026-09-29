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

// Reading and writing interests have different costs: a read is a short query
// for one attendee, while a write rewrites their stored preference record, so
// the write window is a fifth of the read window.
const READ_RULES = {
  routeKey: 'interests-read',
  tokenBucket: { capacity: 20, name: 'ip-burst', refillIntervalMs: 1_000 },
  primarySlidingWindow: { limit: 300, name: 'ip-hour', windowMs: 3_600_000 },
  secondarySlidingWindow: {
    limit: 300,
    name: 'session-hour',
    windowMs: 3_600_000,
  },
} as const satisfies HybridRateLimitRules;

const WRITE_RULES = {
  routeKey: 'interests-write',
  tokenBucket: { capacity: 5, name: 'ip-burst', refillIntervalMs: 1_000 },
  primarySlidingWindow: { limit: 60, name: 'ip-hour', windowMs: 3_600_000 },
  secondarySlidingWindow: {
    limit: 60,
    name: 'session-hour',
    windowMs: 3_600_000,
  },
} as const satisfies HybridRateLimitRules;

interface InterestsRequest {
  headers: { cookie?: string };
  ip?: string;
  socket: { remoteAddress?: string };
}

interface InterestsResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class InterestsRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly secret: string,
  ) {}

  check(
    rules: HybridRateLimitRules,
    clientIp: string,
    sessionToken?: string,
  ): Promise<RateLimitDecision> {
    const prefix = `eventa:rate-limit:{${rules.routeKey}}`;
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
      rules,
      tokenBucketKey: `${prefix}:bucket:ip:${hash(`ip:${clientIp}`)}`,
    });
  }
}

abstract class InterestsRateLimitGuard implements CanActivate {
  protected abstract readonly rules: HybridRateLimitRules;
  protected abstract readonly diagnosticCode: string;
  protected abstract readonly message: string;

  constructor(
    private readonly limits: InterestsRateLimitService,
    private readonly cookie: AttendeeSessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<InterestsRequest>();
    const response = http.getResponse<InterestsResponse>();
    try {
      const decision = await this.limits.check(
        this.rules,
        request.ip || request.socket.remoteAddress || 'unknown',
        this.cookie.read(request.headers.cookie),
      );
      this.headers(response, decision);
      if (decision.allowed) return true;
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        this.diagnosticCode,
        this.message,
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'DISCOVERY_SERVICE_UNAVAILABLE',
          'Interests are temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }
      throw error;
    }
  }

  private headers(response: InterestsResponse, decision: RateLimitDecision) {
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

@Injectable()
export class InterestsReadRateLimitGuard extends InterestsRateLimitGuard {
  protected readonly rules = READ_RULES;
  protected readonly diagnosticCode = 'INTERESTS_READ_RATE_LIMITED';
  protected readonly message = 'Wait before loading your interests again.';

  constructor(limits: InterestsRateLimitService, cookie: AttendeeSessionCookie) {
    super(limits, cookie);
  }
}

@Injectable()
export class InterestsWriteRateLimitGuard extends InterestsRateLimitGuard {
  protected readonly rules = WRITE_RULES;
  protected readonly diagnosticCode = 'INTERESTS_WRITE_RATE_LIMITED';
  protected readonly message = 'Wait before saving your interests again.';

  constructor(limits: InterestsRateLimitService, cookie: AttendeeSessionCookie) {
    super(limits, cookie);
  }
}
