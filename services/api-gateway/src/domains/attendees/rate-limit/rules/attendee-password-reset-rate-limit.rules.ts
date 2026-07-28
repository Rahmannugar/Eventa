import type { HybridRateLimitRules } from '../../../../rate-limit/types/rate-limit.types';

export const ATTENDEE_FORGOT_PASSWORD_RATE_LIMIT_RULES = {
  routeKey: 'attendee-forgot-password',
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
    limit: 10,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

export const ATTENDEE_RESET_PASSWORD_RATE_LIMIT_RULES = {
  routeKey: 'attendee-reset-password',
  tokenBucket: {
    capacity: 10,
    name: 'ip-burst',
    refillIntervalMs: 6_000,
  },
  primarySlidingWindow: {
    limit: 60,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 15,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;
