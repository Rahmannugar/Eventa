import type { HybridRateLimitRules } from '../../../../rate-limit/types/rate-limit.types';

export const ATTENDEE_EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_RULES = {
  routeKey: 'attendee-email-verification-confirm',
  tokenBucket: {
    capacity: 10,
    name: 'ip-burst',
    refillIntervalMs: 6_000,
  },
  primarySlidingWindow: {
    limit: 120,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 30,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

export const ATTENDEE_EMAIL_VERIFICATION_RESEND_RATE_LIMIT_RULES = {
  routeKey: 'attendee-email-verification-resend',
  tokenBucket: {
    capacity: 5,
    name: 'ip-burst',
    refillIntervalMs: 12_000,
  },
  primarySlidingWindow: {
    limit: 30,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 20,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;
