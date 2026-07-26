import { createHmac, randomUUID } from 'node:crypto';

import type { RateLimitState } from '../../../../rate-limit/ports/rate-limit.state';
import type {
  HybridRateLimitRules,
  RateLimitDecision,
} from '../../../../rate-limit/types/rate-limit.types';
import {
  ATTENDEE_EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_RULES,
  ATTENDEE_EMAIL_VERIFICATION_RESEND_RATE_LIMIT_RULES,
} from '../rules/attendee-email-verification-rate-limit.rules';

export type AttendeeEmailVerificationOperation = 'confirm' | 'resend';

interface EmailVerificationRateLimitAttempt {
  clientIp: string;
  email?: string;
}

export class AttendeeEmailVerificationRateLimitService {
  constructor(
    private readonly state: RateLimitState,
    private readonly keySecret: string,
  ) {}

  check(
    operation: AttendeeEmailVerificationOperation,
    attempt: EmailVerificationRateLimitAttempt,
  ): Promise<RateLimitDecision> {
    const rules = this.rules(operation);
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

  private rules(
    operation: AttendeeEmailVerificationOperation,
  ): HybridRateLimitRules {
    return operation === 'confirm'
      ? ATTENDEE_EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_RULES
      : ATTENDEE_EMAIL_VERIFICATION_RESEND_RATE_LIMIT_RULES;
  }
}
