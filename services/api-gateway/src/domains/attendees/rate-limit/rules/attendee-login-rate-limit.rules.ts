import type { HybridRateLimitRules } from '../../../../rate-limit/types/rate-limit.types';

export const ATTENDEE_LOGIN_RATE_LIMIT_RULES = {
  routeKey: 'attendee-login',
  tokenBucket: {
    capacity: 10,
    name: 'ip-burst',
    refillIntervalMs: 6_000,
  },
  primarySlidingWindow: {
    limit: 100,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 10,
    name: 'email-15-minutes',
    windowMs: 15 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;
