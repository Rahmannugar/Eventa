import type { AttendeeRegistrationRateLimitRules } from '../types/rate-limit.types';

export const ATTENDEE_REGISTRATION_RATE_LIMIT_RULES = {
  routeKey: 'attendee-registration',
  tokenBucket: {
    capacity: 5,
    name: 'ip-burst',
    refillIntervalMs: 12_000,
  },
  ipSlidingWindow: {
    limit: 30,
    name: 'ip-hour',
    windowMs: 60 * 60 * 1_000,
  },
  identitySlidingWindow: {
    limit: 5,
    name: 'email-hour',
    windowMs: 60 * 60 * 1_000,
  },
} as const satisfies AttendeeRegistrationRateLimitRules;
