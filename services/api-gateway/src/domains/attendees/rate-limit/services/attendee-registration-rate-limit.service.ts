import { createHmac, randomUUID } from 'node:crypto';

import type {
  RateLimitDecision,
  RateLimitStore,
} from '../../../../rate-limit/types/rate-limit.types';
import { ATTENDEE_REGISTRATION_RATE_LIMIT_RULES } from '../rules/attendee-registration-rate-limit.rules';
import type { RegistrationRateLimitAttempt } from '../types/attendee-registration-rate-limit.types';

export class AttendeeRegistrationRateLimitService {
  constructor(
    private readonly store: RateLimitStore,
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

    const storeAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    };

    return this.store.consume(
      secondarySlidingWindowKey === undefined
        ? storeAttempt
        : { ...storeAttempt, secondarySlidingWindowKey },
    );
  }

  private hashSubject(subject: string): string {
    return createHmac('sha256', this.keySecret).update(subject).digest('hex');
  }
}
