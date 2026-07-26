import { describe, expect, it } from 'vitest';

import { AttendeeEmailVerificationRateLimitService } from '../../src/domains/attendees/rate-limit/services/attendee-email-verification-rate-limit.service';
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

describe('AttendeeEmailVerificationRateLimitService', () => {
  it('separates confirm and resend quotas while protecting canonical subjects', async () => {
    const state = new RecordingRateLimitState();
    const service = new AttendeeEmailVerificationRateLimitService(
      state,
      'a-development-secret-that-is-32-chars',
    );

    await service.check('confirm', {
      clientIp: '203.0.113.10',
      email: ' Attendee@Example.COM ',
    });
    await service.check('resend', {
      clientIp: '203.0.113.10',
      email: 'attendee@example.com',
    });

    const [confirm, resend] = state.attempts;
    expect(confirm?.rules.routeKey).toBe('attendee-email-verification-confirm');
    expect(resend?.rules.routeKey).toBe('attendee-email-verification-resend');
    expect(confirm?.tokenBucketKey).not.toBe(resend?.tokenBucketKey);
    expect(confirm?.secondarySlidingWindowKey).not.toContain(
      'attendee@example.com',
    );
    expect(resend?.secondarySlidingWindowKey).not.toContain(
      'attendee@example.com',
    );
  });
});
