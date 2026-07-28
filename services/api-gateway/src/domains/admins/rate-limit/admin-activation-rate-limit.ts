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

type AdminActivationOperation = 'complete' | 'confirm';

const RULES: Record<AdminActivationOperation, HybridRateLimitRules> = {
  confirm: {
    routeKey: 'admin-activation-confirm',
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
      limit: 10,
      name: 'email-fifteen-minutes',
      windowMs: 15 * 60 * 1_000,
    },
  },
  complete: {
    routeKey: 'admin-activation-complete',
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
      name: 'ip-fifteen-minutes',
      windowMs: 15 * 60 * 1_000,
    },
  },
};

interface RateLimitedRequest {
  body: unknown;
  ip?: string;
  socket: { remoteAddress?: string };
}

interface RateLimitResponse {
  setHeader(name: string, value: string): void;
}

export class AdminActivationRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(
    operation: AdminActivationOperation,
    clientIp: string,
    email?: string,
  ): Promise<RateLimitDecision> {
    const rules = RULES[operation];
    const keyPrefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const baseAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${this.hash(`ip:${clientIp}`)}`,
      rules,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${this.hash(`ip:${clientIp}`)}`,
    };
    const canonicalEmail = email?.trim().toLowerCase();

    const secondarySubject =
      operation === 'confirm' && canonicalEmail !== undefined
        ? `email:${canonicalEmail}`
        : `ip-short:${clientIp}`;

    return this.state.consume({
      ...baseAttempt,
      secondarySlidingWindowKey: `${keyPrefix}:window:secondary:${this.hash(secondarySubject)}`,
    });
  }

  private hash(value: string): string {
    return createHmac('sha256', this.keySecret).update(value).digest('hex');
  }
}

@Injectable()
export class AdminActivationConfirmRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: AdminActivationRateLimitService) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    return enforce(
      context,
      this.rateLimits,
      'confirm',
      readEmail(request.body),
    );
  }
}

@Injectable()
export class AdminActivationCompleteRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: AdminActivationRateLimitService) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    return enforce(context, this.rateLimits, 'complete');
  }
}

async function enforce(
  context: ExecutionContext,
  rateLimits: AdminActivationRateLimitService,
  operation: AdminActivationOperation,
  email?: string,
): Promise<boolean> {
  const http = context.switchToHttp();
  const request = http.getRequest<RateLimitedRequest>();
  const response = http.getResponse<RateLimitResponse>();
  const clientIp = request.ip || request.socket.remoteAddress || 'unknown';

  try {
    const decision = await rateLimits.check(operation, clientIp, email);
    setHeaders(response, decision);

    if (decision.allowed) {
      return true;
    }

    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    throw new ApiHttpException(
      HttpStatus.TOO_MANY_REQUESTS,
      'ADMIN_ACTIVATION_RATE_LIMITED',
      'Wait before trying admin activation again.',
    );
  } catch (error: unknown) {
    if (error instanceof RateLimitStateUnavailableError) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ADMIN_ACTIVATION_UNAVAILABLE',
        'Admin activation is temporarily unavailable. Try again later.',
        { diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE' },
      );
    }

    throw error;
  }
}

function readEmail(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('email' in body)) {
    return undefined;
  }

  const email = Reflect.get(body, 'email');
  return typeof email === 'string' && email.trim() !== '' ? email : undefined;
}

function setHeaders(
  response: RateLimitResponse,
  decision: RateLimitDecision,
): void {
  response.setHeader(
    'RateLimit-Policy',
    decision.limits
      .map(
        (limit) => `"${limit.name}";q=${limit.quota};w=${limit.windowSeconds}`,
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
