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

const RULES: HybridRateLimitRules = {
  routeKey: 'admin-activation',
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
    clientIp: string,
    email: string | undefined,
  ): Promise<RateLimitDecision> {
    const keyPrefix = `eventa:rate-limit:{${RULES.routeKey}}`;
    const baseAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${this.hash(`ip:${clientIp}`)}`,
      rules: RULES,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${this.hash(`ip:${clientIp}`)}`,
    };
    const canonicalEmail = email?.trim().toLowerCase();

    const secondarySubject =
      canonicalEmail === undefined
        ? `ip-short:${clientIp}`
        : `email:${canonicalEmail}`;

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
export class AdminActivationRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimits: AdminActivationRateLimitService) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    return enforce(context, this.rateLimits, readEmail(request.body));
  }
}

async function enforce(
  context: ExecutionContext,
  rateLimits: AdminActivationRateLimitService,
  email?: string,
): Promise<boolean> {
  const http = context.switchToHttp();
  const request = http.getRequest<RateLimitedRequest>();
  const response = http.getResponse<RateLimitResponse>();
  const clientIp = request.ip || request.socket.remoteAddress || 'unknown';

  try {
    const decision = await rateLimits.check(clientIp, email);
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
