import { HttpException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AttendeeRegistrationRateLimitGuard } from '../../src/domains/attendees/rate-limit/guards/attendee-registration-rate-limit.guard';
import { AttendeeRegistrationRateLimitService } from '../../src/domains/attendees/rate-limit/services/attendee-registration-rate-limit.service';
import { RateLimitStoreUnavailableError } from '../../src/rate-limit/errors/rate-limit.errors';
import type {
  RateLimitDecision,
  RateLimitStore,
} from '../../src/rate-limit/types/rate-limit.types';
import { ApiHttpException } from '../../src/http/errors/api-http.exception';

class FixedRateLimitStore implements RateLimitStore {
  constructor(private readonly outcome: RateLimitDecision | Error) {}

  consume(): Promise<RateLimitDecision> {
    return this.outcome instanceof Error
      ? Promise.reject(this.outcome)
      : Promise.resolve(this.outcome);
  }
}

function createContext(headers: Map<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        body: { email: 'attendee@example.com' },
        ip: '203.0.113.10',
        socket: {},
      }),
      getResponse: () => ({
        setHeader: (name: string, value: string) => headers.set(name, value),
      }),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(
  store: RateLimitStore,
): AttendeeRegistrationRateLimitGuard {
  const service = new AttendeeRegistrationRateLimitService(
    store,
    'a-development-secret-that-is-32-chars',
  );

  return new AttendeeRegistrationRateLimitGuard(service);
}

describe('AttendeeRegistrationRateLimitGuard', () => {
  it('returns 429 with Retry-After when the registration attempt is denied', async () => {
    const headers = new Map<string, string>();
    const guard = createGuard(
      new FixedRateLimitStore({
        allowed: false,
        limits: [
          {
            name: 'ip-burst',
            quota: 5,
            remaining: 0,
            resetAfterSeconds: 42,
            windowSeconds: 60,
          },
        ],
        retryAfterSeconds: 42,
      }),
    );

    const rejection = guard.canActivate(createContext(headers));

    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await expect(rejection).rejects.toMatchObject({ status: 429 });
    expect(headers.get('Retry-After')).toBe('42');
    expect(headers.get('RateLimit-Policy')).toBe('"ip-burst";q=5;w=60');
    expect(headers.get('RateLimit')).toBe('"ip-burst";r=0;t=42');
  });

  it('fails closed when Redis cannot make the security decision', async () => {
    const guard = createGuard(
      new FixedRateLimitStore(new RateLimitStoreUnavailableError()),
    );

    await expect(
      guard.canActivate(createContext(new Map())),
    ).rejects.toMatchObject({
      diagnosticCode: 'RATE_LIMIT_STORE_UNAVAILABLE',
      status: 503,
    });
  });

  it('uses the stable public error contract for denied attempts', async () => {
    const guard = createGuard(
      new FixedRateLimitStore({
        allowed: false,
        limits: [],
        retryAfterSeconds: 12,
      }),
    );

    const rejection = guard.canActivate(createContext(new Map()));

    await expect(rejection).rejects.toBeInstanceOf(ApiHttpException);
    await expect(rejection).rejects.toMatchObject({ status: 429 });
  });
});
