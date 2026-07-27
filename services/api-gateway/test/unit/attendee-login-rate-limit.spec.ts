import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AttendeeLoginRateLimitGuard } from '../../src/domains/attendees/rate-limit/guards/attendee-login-rate-limit.guard';
import { AttendeeLoginRateLimitService } from '../../src/domains/attendees/rate-limit/services/attendee-login-rate-limit.service';
import { RateLimitStateUnavailableError } from '../../src/rate-limit/errors/rate-limit.errors';
import type { RateLimitState } from '../../src/rate-limit/ports/rate-limit.state';
import type {
  AtomicRateLimitAttempt,
  RateLimitDecision,
} from '../../src/rate-limit/types/rate-limit.types';

class RecordingState implements RateLimitState {
  attempts: AtomicRateLimitAttempt[] = [];

  constructor(private readonly outcome?: RateLimitDecision | Error) {}

  consume(attempt: AtomicRateLimitAttempt): Promise<RateLimitDecision> {
    this.attempts.push(attempt);

    if (this.outcome instanceof Error) {
      return Promise.reject(this.outcome);
    }

    return Promise.resolve(
      this.outcome ?? {
        allowed: true,
        limits: [],
        retryAfterSeconds: 0,
      },
    );
  }
}

function service(state: RateLimitState): AttendeeLoginRateLimitService {
  return new AttendeeLoginRateLimitService(
    state,
    'a-development-secret-that-is-32-chars',
  );
}

function context(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        body: { email: 'attendee@example.com' },
        ip: '203.0.113.10',
        socket: {},
      }),
      getResponse: () => ({ setHeader: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('Attendee login rate limiting', () => {
  it('uses stable protected subjects for canonical-equivalent identities', async () => {
    const state = new RecordingState();
    const limits = service(state);

    await limits.check({
      clientIp: '203.0.113.10',
      email: ' Attendee@Example.COM ',
    });
    await limits.check({
      clientIp: '203.0.113.10',
      email: 'attendee@example.com',
    });

    expect(state.attempts[0]?.tokenBucketKey).toBe(
      state.attempts[1]?.tokenBucketKey,
    );
    expect(state.attempts[0]?.secondarySlidingWindowKey).toBe(
      state.attempts[1]?.secondarySlidingWindowKey,
    );
    expect(state.attempts[0]?.secondarySlidingWindowKey).not.toContain(
      'attendee@example.com',
    );
  });

  it('returns the login-specific denial and fails closed when state is unavailable', async () => {
    const denied = new AttendeeLoginRateLimitGuard(
      service(
        new RecordingState({
          allowed: false,
          limits: [],
          retryAfterSeconds: 12,
        }),
      ),
    );
    await expect(denied.canActivate(context())).rejects.toMatchObject({
      response: { code: 'LOGIN_RATE_LIMITED', statusCode: 429 },
      status: 429,
    });

    const unavailable = new AttendeeLoginRateLimitGuard(
      service(new RecordingState(new RateLimitStateUnavailableError())),
    );
    await expect(unavailable.canActivate(context())).rejects.toMatchObject({
      diagnosticCode: 'RATE_LIMIT_STATE_UNAVAILABLE',
      response: { code: 'AUTHENTICATION_UNAVAILABLE', statusCode: 503 },
      status: 503,
    });
  });
});
