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
import { AdminSessionCookie } from '../services/admin-session-cookie.service';

const ACCOUNT_RULES = {
  routeKey: 'admin-account',
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

const LOGOUT_RULES = {
  routeKey: 'admin-logout',
  tokenBucket: {
    capacity: 10,
    name: 'ip-burst',
    refillIntervalMs: 6_000,
  },
  primarySlidingWindow: {
    limit: 100,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 30,
    name: 'session-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

type AdminSessionOperation = 'account' | 'logout';

interface SessionRequest {
  headers: { cookie?: string };
  ip?: string;
  socket: { remoteAddress?: string };
}

interface SessionResponse {
  setHeader(name: string, value: string): void;
}

export class AdminSessionRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(
    operation: AdminSessionOperation,
    clientIp: string,
    sessionToken?: string,
  ): Promise<RateLimitDecision> {
    const rules = operation === 'account' ? ACCOUNT_RULES : LOGOUT_RULES;
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

abstract class AdminSessionRateLimitGuard implements CanActivate {
  protected abstract readonly operation: AdminSessionOperation;

  constructor(
    private readonly rateLimits: AdminSessionRateLimitService,
    private readonly sessionCookie: AdminSessionCookie,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<SessionRequest>();
    const response = http.getResponse<SessionResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const sessionToken = this.sessionCookie.read(request.headers.cookie);

    try {
      const decision = await this.rateLimits.check(
        this.operation,
        clientIp,
        sessionToken,
      );
      this.setHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw this.rateLimited();
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ADMIN_AUTHENTICATION_UNAVAILABLE',
          'Authentication is temporarily unavailable. Try again later.',
          { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
        );
      }

      throw error;
    }
  }

  private rateLimited(): ApiHttpException {
    switch (this.operation) {
      case 'account':
        return new ApiHttpException(
          HttpStatus.TOO_MANY_REQUESTS,
          'ADMIN_ACCOUNT_RATE_LIMITED',
          'Wait before requesting your account again.',
        );
      case 'logout':
        return new ApiHttpException(
          HttpStatus.TOO_MANY_REQUESTS,
          'ADMIN_LOGOUT_RATE_LIMITED',
          'Wait before trying to sign out again.',
        );
    }
  }

  private setHeaders(
    response: SessionResponse,
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
export class AdminAccountRateLimitGuard extends AdminSessionRateLimitGuard {
  protected readonly operation = 'account' as const;

  constructor(
    rateLimits: AdminSessionRateLimitService,
    sessionCookie: AdminSessionCookie,
  ) {
    super(rateLimits, sessionCookie);
  }
}

@Injectable()
export class AdminLogoutRateLimitGuard extends AdminSessionRateLimitGuard {
  protected readonly operation = 'logout' as const;

  constructor(
    rateLimits: AdminSessionRateLimitService,
    sessionCookie: AdminSessionCookie,
  ) {
    super(rateLimits, sessionCookie);
  }
}
