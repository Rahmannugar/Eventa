import { createHmac, randomUUID } from 'node:crypto';

import type { RateLimitDecision } from '../../../../rate-limit/types/rate-limit.types';
import type { RateLimitState } from '../../../../rate-limit/ports/rate-limit.state';
import { ATTENDEE_LOGIN_RATE_LIMIT_RULES } from '../rules/attendee-login-rate-limit.rules';

interface LoginRateLimitAttempt {
  clientIp: string;
  email?: string;
}

export class AttendeeLoginRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(attempt: LoginRateLimitAttempt): Promise<RateLimitDecision> {
    const rules = ATTENDEE_LOGIN_RATE_LIMIT_RULES;
    const keyPrefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ipSubject = this.hash(`ip:${attempt.clientIp}`);
    const email = attempt.email?.trim().toLowerCase();
    const baseAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    };

    return this.state.consume(
      email === undefined
        ? baseAttempt
        : {
            ...baseAttempt,
            secondarySlidingWindowKey: `${keyPrefix}:window:identity:${this.hash(`email:${email}`)}`,
          },
    );
  }

  private hash(subject: string): string {
    return createHmac('sha256', this.keySecret).update(subject).digest('hex');
  }
}
