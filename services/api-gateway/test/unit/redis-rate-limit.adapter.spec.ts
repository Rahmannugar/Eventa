import { describe, expect, it } from 'vitest';

import { RedisRateLimitAdapter } from '../../src/rate-limit/adapters/redis-rate-limit.adapter';
import { RateLimitStoreUnavailableError } from '../../src/rate-limit/errors/rate-limit.errors';
import type {
  AtomicRateLimitAttempt,
  RateLimitRedisClient,
  RateLimitRedisCommandClient,
} from '../../src/rate-limit/types/rate-limit.types';

const attempt: AtomicRateLimitAttempt = {
  member: 'request-1',
  primarySlidingWindowKey: 'test:{registration}:primary',
  rules: {
    routeKey: 'attendee-registration',
    tokenBucket: {
      capacity: 5,
      name: 'ip-burst',
      refillIntervalMs: 1_000,
    },
    primarySlidingWindow: {
      limit: 10,
      name: 'email-window',
      windowMs: 60_000,
    },
    secondarySlidingWindow: {
      limit: 20,
      name: 'ip-window',
      windowMs: 60_000,
    },
  },
  secondarySlidingWindowKey: 'test:{registration}:secondary',
  tokenBucketKey: 'test:{registration}:bucket',
};

describe('RedisRateLimitAdapter operation timeout', () => {
  it('aborts a Redis operation that exceeds its configured budget', async () => {
    let receivedSignal: AbortSignal | undefined;
    const evalCommand: RateLimitRedisCommandClient['eval'] = () =>
      new Promise((_, reject) => {
        receivedSignal?.addEventListener(
          'abort',
          () => reject(new Error('Redis operation timed out')),
          { once: true },
        );
      });
    const commandClient: RateLimitRedisCommandClient = { eval: evalCommand };
    const client: RateLimitRedisClient = {
      close: () => Promise.resolve(),
      connect: () => Promise.resolve(),
      eval: evalCommand,
      isOpen: true,
      isReady: true,
      on: () => undefined,
      withAbortSignal: (signal) => {
        receivedSignal = signal;
        return commandClient;
      },
    };
    const adapter = new RedisRateLimitAdapter(client, 10);

    await expect(adapter.consume(attempt)).rejects.toBeInstanceOf(
      RateLimitStoreUnavailableError,
    );
    expect(receivedSignal?.aborted).toBe(true);
  });
});
