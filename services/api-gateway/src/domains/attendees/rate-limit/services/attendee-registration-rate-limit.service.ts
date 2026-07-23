import { createHmac, randomUUID } from 'node:crypto';

import type { RateLimitDecision } from '../../../../rate-limit/types/rate-limit.types';
import type { RateLimitState } from '../../../../rate-limit/ports/rate-limit.state';
import { ATTENDEE_REGISTRATION_RATE_LIMIT_RULES } from '../rules/attendee-registration-rate-limit.rules';
import type { RegistrationRateLimitAttempt } from '../types/attendee-registration-rate-limit.types';

export class AttendeeRegistrationRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(attempt: RegistrationRateLimitAttempt): Promise<RateLimitDecision> {
    const rules = ATTENDEE_REGISTRATION_RATE_LIMIT_RULES;
    const keyPrefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ipSubject = this.hashSubject(`ip:${attempt.clientIp}`);
    const normalizedEmail = attempt.email?.trim().toLowerCase();
    const secondarySlidingWindowKey = normalizedEmail
      ? `${keyPrefix}:window:identity:${this.hashSubject(`email:${normalizedEmail}`)}`
      : undefined;

    const stateAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    };

    return this.state.consume(
      secondarySlidingWindowKey === undefined
        ? stateAttempt
        : { ...stateAttempt, secondarySlidingWindowKey },
    );
  }

  private hashSubject(subject: string): string {
    return createHmac('sha256', this.keySecret).update(subject).digest('hex');
  }
}
