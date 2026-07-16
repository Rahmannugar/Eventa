import { describe, expect, it } from 'vitest';

import { AttendeeRegistrationRateLimitService } from '../../src/domains/attendees/rate-limit/services/attendee-registration-rate-limit.service';
import type {
  AtomicRateLimitAttempt,
  RateLimitDecision,
  RateLimitStore,
} from '../../src/rate-limit/types/rate-limit.types';

class RecordingRateLimitStore implements RateLimitStore {
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
    const store = new RecordingRateLimitStore();
    const service = new AttendeeRegistrationRateLimitService(
      store,
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

    const [first, second] = store.attempts;

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
    const store = new RecordingRateLimitStore();
    const service = new AttendeeRegistrationRateLimitService(
      store,
      'a-development-secret-that-is-32-chars',
    );

    await service.check({ clientIp: '203.0.113.10' });

    expect(store.attempts[0]).not.toHaveProperty('secondarySlidingWindowKey');
  });
});
