import { createHmac, randomUUID } from 'node:crypto';

import type { RateLimitState } from '../../../../rate-limit/ports/rate-limit.state';
import type {
  HybridRateLimitRules,
  RateLimitDecision,
} from '../../../../rate-limit/types/rate-limit.types';
import {
  ATTENDEE_FORGOT_PASSWORD_RATE_LIMIT_RULES,
  ATTENDEE_RESET_PASSWORD_RATE_LIMIT_RULES,
} from '../rules/attendee-password-reset-rate-limit.rules';

export type AttendeePasswordResetOperation = 'forgot' | 'reset';

interface PasswordResetRateLimitAttempt {
  clientIp: string;
  email?: string;
}

export class AttendeePasswordResetRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(
    operation: AttendeePasswordResetOperation,
    attempt: PasswordResetRateLimitAttempt,
  ): Promise<RateLimitDecision> {
    const rules = this.rules(operation);
    const prefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ip = this.hash(`ip:${attempt.clientIp}`);
    const email = attempt.email?.trim().toLowerCase();
    const baseAttempt = {
      member: randomUUID(),
      primarySlidingWindowKey: `${prefix}:window:ip:${ip}`,
      rules,
      tokenBucketKey: `${prefix}:bucket:ip:${ip}`,
    };

    return this.state.consume(
      email === undefined
        ? baseAttempt
        : {
            ...baseAttempt,
            secondarySlidingWindowKey: `${prefix}:window:email:${this.hash(`email:${email}`)}`,
          },
    );
  }

  private hash(value: string): string {
    return createHmac('sha256', this.keySecret).update(value).digest('hex');
  }

  private rules(
    operation: AttendeePasswordResetOperation,
  ): HybridRateLimitRules {
    return operation === 'forgot'
      ? ATTENDEE_FORGOT_PASSWORD_RATE_LIMIT_RULES
      : ATTENDEE_RESET_PASSWORD_RATE_LIMIT_RULES;
  }
}
