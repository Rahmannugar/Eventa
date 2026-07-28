import { createHmac, randomUUID } from 'node:crypto';

import type { RateLimitState } from '../../../../rate-limit/ports/rate-limit.state';
import type {
  HybridRateLimitRules,
  RateLimitDecision,
} from '../../../../rate-limit/types/rate-limit.types';
import {
  ATTENDEE_LOGOUT_RATE_LIMIT_RULES,
  ATTENDEE_ACCOUNT_RATE_LIMIT_RULES,
} from '../rules/attendee-session-rate-limit.rules';

type AttendeeSessionOperation = 'account' | 'logout';

interface AttendeeSessionRateLimitAttempt {
  clientIp: string;
  sessionToken?: string;
}

export class AttendeeSessionRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(
    operation: AttendeeSessionOperation,
    attempt: AttendeeSessionRateLimitAttempt,
  ): Promise<RateLimitDecision> {
    const rules = this.rules(operation);
    const keyPrefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ipSubject = this.hash(`ip:${attempt.clientIp}`);
    const baseAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      rules,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    };

    return this.state.consume(
      attempt.sessionToken === undefined
        ? baseAttempt
        : {
            ...baseAttempt,
            secondarySlidingWindowKey: `${keyPrefix}:window:session:${this.hash(`session:${attempt.sessionToken}`)}`,
          },
    );
  }

  private hash(subject: string): string {
    return createHmac('sha256', this.keySecret).update(subject).digest('hex');
  }

  private rules(operation: AttendeeSessionOperation): HybridRateLimitRules {
    return operation === 'account'
      ? ATTENDEE_ACCOUNT_RATE_LIMIT_RULES
      : ATTENDEE_LOGOUT_RATE_LIMIT_RULES;
  }
}
