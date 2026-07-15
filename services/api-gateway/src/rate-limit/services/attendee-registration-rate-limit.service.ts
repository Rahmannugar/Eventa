import { createHmac, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { RATE_LIMIT_STORE } from '../constants/rate-limit.constants';
import { ATTENDEE_REGISTRATION_RATE_LIMIT_RULES } from '../rules/attendee-registration-rate-limit.rules';
import type {
  RateLimitDecision,
  RateLimitStore,
  RegistrationRateLimitAttempt,
} from '../types/rate-limit.types';

@Injectable()
export class AttendeeRegistrationRateLimitService {
  constructor(
    @Inject(RATE_LIMIT_STORE)
    private readonly store: RateLimitStore,
    private readonly keySecret: string,
  ) {}

  check(attempt: RegistrationRateLimitAttempt): Promise<RateLimitDecision> {
    const rules = ATTENDEE_REGISTRATION_RATE_LIMIT_RULES;
    const keyPrefix = `eventa:rate-limit:{${rules.routeKey}}`;
    const ipSubject = this.hashSubject(`ip:${attempt.clientIp}`);
    const normalizedEmail = attempt.email?.trim().toLowerCase();
    const identityKey = normalizedEmail
      ? `${keyPrefix}:window:identity:${this.hashSubject(`email:${normalizedEmail}`)}`
      : undefined;

    const storeAttempt = {
      ipSlidingWindowKey: `${keyPrefix}:window:ip:${ipSubject}`,
      member: randomUUID(),
      rules,
      tokenBucketKey: `${keyPrefix}:bucket:ip:${ipSubject}`,
    };

    return this.store.consume(
      identityKey === undefined
        ? storeAttempt
        : { ...storeAttempt, identityKey },
    );
  }

  private hashSubject(subject: string): string {
    return createHmac('sha256', this.keySecret).update(subject).digest('hex');
  }
}
