import { describe, expect, it } from 'vitest';

import { AttendeeRegistrationRateLimitService } from '../../src/domains/attendees/rate-limit/services/attendee-registration-rate-limit.service';
import type {
  AtomicRateLimitAttempt,
  RateLimitDecision,
} from '../../src/rate-limit/types/rate-limit.types';
import type { RateLimitState } from '../../src/rate-limit/ports/rate-limit.state';

class RecordingRateLimitState implements RateLimitState {
  attempts: AtomicRateLimitAttempt[] = [];

  consume(attempt: AtomicRateLimitAttempt): Promise<RateLimitDecision> {
    this.attempts.push(attempt);
    return Promise.resolve({
      allowed: true,
      limits: [],
      retryAfterSeconds: 0,
    });
  }
}

describe('AttendeeRegistrationRateLimitService', () => {
  it('uses deterministic HMAC subjects and canonicalizes email identity', async () => {
    const state = new RecordingRateLimitState();
    const service = new AttendeeRegistrationRateLimitService(
      state,
      'a-development-secret-that-is-32-chars',
    );

    await service.check({
      clientIp: '203.0.113.10',
      email: ' Attendee@Example.COM ',
    });
    await service.check({
      clientIp: '203.0.113.10',
      email: 'attendee@example.com',
    });

    const [first, second] = state.attempts;

    expect(first?.tokenBucketKey).toBe(second?.tokenBucketKey);
    expect(first?.primarySlidingWindowKey).toBe(
      second?.primarySlidingWindowKey,
    );
    expect(first?.secondarySlidingWindowKey).toBe(
      second?.secondarySlidingWindowKey,
    );
    expect(first?.secondarySlidingWindowKey).not.toContain(
      'attendee@example.com',
    );
    expect(first?.member).not.toBe(second?.member);
  });

  it('applies only IP rules when no email identity is available', async () => {
    const state = new RecordingRateLimitState();
    const service = new AttendeeRegistrationRateLimitService(
      state,
      'a-development-secret-that-is-32-chars',
    );

    await service.check({ clientIp: '203.0.113.10' });

    expect(state.attempts[0]).not.toHaveProperty('secondarySlidingWindowKey');
  });
});
