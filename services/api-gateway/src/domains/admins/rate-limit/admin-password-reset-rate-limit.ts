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

const FORGOT_RULES = {
  routeKey: 'admin-forgot-password',
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
    limit: 10,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

const RESET_RULES = {
  routeKey: 'admin-reset-password',
  tokenBucket: {
    capacity: 10,
    name: 'ip-burst',
    refillIntervalMs: 6_000,
  },
  primarySlidingWindow: {
    limit: 60,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 15,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

type Operation = 'forgot' | 'reset';

interface PasswordResetRequest {
  body: unknown;
  ip?: string;
  socket: { remoteAddress?: string };
}

interface RateLimitResponse {
  setHeader(name: string, value: string): void;
}

export class AdminPasswordResetRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(
    operation: Operation,
    clientIp: string,
    email?: string,
  ): Promise<RateLimitDecision> {
    const rules = operation === 'forgot' ? FORGOT_RULES : RESET_RULES;
    const prefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ip = this.hash(`ip:${clientIp}`);
    const canonicalEmail = email?.trim().toLowerCase();
    const attempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${prefix}:window:ip:${ip}`,
      rules,
      tokenBucketKey: `${prefix}:bucket:ip:${ip}`,
    };

    return this.state.consume(
      canonicalEmail === undefined
        ? attempt
        : {
            ...attempt,
            secondarySlidingWindowKey: `${prefix}:window:email:${this.hash(`email:${canonicalEmail}`)}`,
          },
    );
  }

  private hash(value: string): string {
    return createHmac('sha256', this.keySecret).update(value).digest('hex');
  }
}

abstract class AdminPasswordResetRateLimitGuard implements CanActivate {
  protected abstract readonly operation: Operation;

  constructor(
    private readonly rateLimits: AdminPasswordResetRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<PasswordResetRequest>();
    const response = http.getResponse<RateLimitResponse>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const email = this.readEmail(request.body);

    try {
      const decision = await this.rateLimits.check(
        this.operation,
        clientIp,
        email,
      );
      this.setHeaders(response, decision);

      if (decision.allowed) {
        return true;
      }

      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiHttpException(
        HttpStatus.TOO_MANY_REQUESTS,
        this.operation === 'forgot'
          ? 'ADMIN_FORGOT_PASSWORD_RATE_LIMITED'
          : 'ADMIN_RESET_PASSWORD_RATE_LIMITED',
        this.operation === 'forgot'
          ? 'Wait before requesting another password reset email.'
          : 'Wait before trying another password reset code.',
      );
    } catch (error: unknown) {
      if (error instanceof RateLimitStateUnavailableError) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ADMIN_PASSWORD_RESET_UNAVAILABLE',
          'Password reset is temporarily unavailable. Try again later.',
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

@Injectable()
export class AdminForgotPasswordRateLimitGuard extends AdminPasswordResetRateLimitGuard {
  protected readonly operation = 'forgot' as const;

  constructor(rateLimits: AdminPasswordResetRateLimitService) {
    super(rateLimits);
  }
}

@Injectable()
export class AdminResetPasswordRateLimitGuard extends AdminPasswordResetRateLimitGuard {
  protected readonly operation = 'reset' as const;

  constructor(rateLimits: AdminPasswordResetRateLimitService) {
    super(rateLimits);
  }
}
