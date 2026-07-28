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
  routeKey: 'admin-login',
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
    limit: 10,
    name: 'email-15-minutes',
    windowMs: 15 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

interface LoginRequest {
  body: unknown;
  ip?: string;
  socket: { remoteAddress?: string };
}

interface LoginResponse {
  setHeader(name: string, value: string): void;
}

export class AdminLoginRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(clientIp: string, email?: string): Promise<RateLimitDecision> {
    const keyPrefix = `eventa:rate-limit:{${RULES.routeKey}}`;
    const ipSubject = this.hash(`ip:${clientIp}`);
    const canonicalEmail = email?.trim().toLowerCase();
    const baseAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules: RULES,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    };

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
export class AdminLoginRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: AdminLoginRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<LoginRequest>();
    const response = http.getResponse<LoginResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';

    try {
      const decision = await this.rateLimits.check(
        clientIp,
        this.readEmail(request.body),
      );
      this.setHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        'ADMIN_LOGIN_RATE_LIMITED',
        'Wait before trying to sign in again.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ADMIN_AUTHENTICATION_UNAVAILABLE',
          'Sign in is temporarily unavailable. Try again later.',
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
    response: LoginResponse,
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
