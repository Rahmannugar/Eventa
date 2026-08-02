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

const CREATE_RULES = {
  routeKey: 'admin-event-create',
  tokenBucket: {
    capacity: 20,
    name: 'ip-burst',
    refillIntervalMs: 3_000,
  },
  primarySlidingWindow: {
    limit: 300,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 100,
    name: 'session-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

const READ_RULES = {
  routeKey: 'admin-event-read',
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

const UPDATE_RULES = {
  routeKey: 'admin-event-update',
  tokenBucket: {
    capacity: 30,
    name: 'ip-burst',
    refillIntervalMs: 2_000,
  },
  primarySlidingWindow: {
    limit: 600,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 300,
    name: 'session-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

type AdminEventOperation = 'create' | 'read' | 'update';

interface EventRequest {
  headers: { cookie?: string };
  ip?: string;
  socket: { remoteAddress?: string };
}

interface EventResponse {
  setHeader(name: string, value: string): void;
}

export class AdminEventRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(
    operation: AdminEventOperation,
    clientIp: string,
    sessionToken?: string,
  ): Promise<RateLimitDecision> {
    const rules =
      operation === 'create'
        ? CREATE_RULES
        : operation === 'update'
          ? UPDATE_RULES
          : READ_RULES;
    const keyPrefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ipSubject = this.hash(`ip:${clientIp}`);
    const attempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules,
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

abstract class AdminEventRateLimitGuard implements CanActivate {
  protected abstract readonly operation: AdminEventOperation;

  constructor(
    private readonly rateLimits: AdminEventRateLimitService,
    private readonly sessionCookie: AdminSessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<EventRequest>();
    const response = http.getResponse<EventResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';

    try {
      const decision = await this.rateLimits.check(
        this.operation,
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
        this.operation === 'create'
          ? 'EVENT_CREATE_RATE_LIMITED'
          : this.operation === 'update'
            ? 'EVENT_UPDATE_RATE_LIMITED'
            : 'EVENT_READ_RATE_LIMITED',
        'Wait before trying this event action again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'EVENT_SERVICE_UNAVAILABLE',
          'Event management is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }

  private setHeaders(
    response: EventResponse,
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

@Injectable()
export class AdminEventCreateRateLimitGuard extends AdminEventRateLimitGuard {
  protected readonly operation = 'create' as const;

  constructor(
    rateLimits: AdminEventRateLimitService,
    sessionCookie: AdminSessionCookie,
  ) {
    super(rateLimits, sessionCookie);
  }
}

@Injectable()
export class AdminEventReadRateLimitGuard extends AdminEventRateLimitGuard {
  protected readonly operation = 'read' as const;

  constructor(
    rateLimits: AdminEventRateLimitService,
    sessionCookie: AdminSessionCookie,
  ) {
    super(rateLimits, sessionCookie);
  }
}

@Injectable()
export class AdminEventUpdateRateLimitGuard extends AdminEventRateLimitGuard {
  protected readonly operation = 'update' as const;

  constructor(
    rateLimits: AdminEventRateLimitService,
    sessionCookie: AdminSessionCookie,
  ) {
    super(rateLimits, sessionCookie);
  }
}
