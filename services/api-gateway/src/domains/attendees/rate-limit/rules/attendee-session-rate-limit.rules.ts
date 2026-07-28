import type { HybridRateLimitRules } from '../../../../rate-limit/types/rate-limit.types';

export const ATTENDEE_ACCOUNT_RATE_LIMIT_RULES = {
  routeKey: 'attendee-account',
  tokenBucket: {
    capacity: 30,
    name: 'ip-burst',
    refillIntervalMs: 2_000,
  },
  primarySlidingWindow: {
    limit: 600,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 300,
    name: 'session-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

export const ATTENDEE_LOGOUT_RATE_LIMIT_RULES = {
  routeKey: 'attendee-logout',
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
    limit: 30,
    name: 'session-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;

export const ATTENDEE_DELETION_RATE_LIMIT_RULES = {
  routeKey: 'attendee-deletion',
  tokenBucket: {
    capacity: 5,
    name: 'ip-burst',
    refillIntervalMs: 12_000,
  },
  primarySlidingWindow: {
    limit: 20,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  secondarySlidingWindow: {
    limit: 10,
    name: 'session-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies HybridRateLimitRules;
