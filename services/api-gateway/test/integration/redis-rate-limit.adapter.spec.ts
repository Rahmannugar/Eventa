import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisRateLimitAdapter } from '../../src/rate-limit/adapters/redis-rate-limit.adapter';
import type {
  AtomicRateLimitAttempt,
  HybridRateLimitRules,
} from '../../src/rate-limit/types/rate-limit.types';

const testRedisUrl = process.env.TEST_REDIS_URL;

if (testRedisUrl === undefined || testRedisUrl.trim() === '') {
  throw new Error('TEST_REDIS_URL is required for integration tests');
}

const client = createClient({
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
  url: testRedisUrl,
});
const adapter = new RedisRateLimitAdapter(client);

const baseRules: HybridRateLimitRules = {
  routeKey: 'integration-test',
  tokenBucket: {
    capacity: 100,
    name: 'ip-burst',
    refillIntervalMs: 60_000,
  },
  primarySlidingWindow: {
    limit: 100,
    name: 'primary-window',
    windowMs: 60_000,
  },
  secondarySlidingWindow: {
    limit: 100,
    name: 'secondary-window',
    windowMs: 60_000,
  },
};

function attempt(
  member: string,
  overrides: Partial<AtomicRateLimitAttempt> = {},
): AtomicRateLimitAttempt {
  return {
    member,
    primarySlidingWindowKey: 'test:{registration}:primary:one',
    rules: baseRules,
    secondarySlidingWindowKey: 'test:{registration}:secondary:one',
    tokenBucketKey: 'test:{registration}:bucket:one',
    ...overrides,
  };
}

describe('RedisRateLimitAdapter', () => {
  beforeAll(async () => {
    await client.connect();
  });

  beforeEach(async () => {
    await client.flushDb();
  });

  afterAll(async () => {
    await adapter.onApplicationShutdown();
  });

  it('enforces the token bucket burst capacity', async () => {
    const rules: HybridRateLimitRules = {
      ...baseRules,
      tokenBucket: {
        capacity: 2,
        name: 'ip-burst',
        refillIntervalMs: 60_000,
      },
    };

    await expect(
      adapter.consume(attempt('one', { rules })),
    ).resolves.toMatchObject({ allowed: true, retryAfterSeconds: 0 });
    await expect(
      adapter.consume(attempt('two', { rules })),
    ).resolves.toMatchObject({ allowed: true, retryAfterSeconds: 0 });

    const denied = await adapter.consume(attempt('three', { rules }));

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.limits).toContainEqual(
      expect.objectContaining({ name: 'ip-burst', remaining: 0 }),
    );
  });

  it('enforces primary and secondary sliding windows independently', async () => {
    const primaryRules: HybridRateLimitRules = {
      ...baseRules,
      primarySlidingWindow: {
        limit: 2,
        name: 'primary-window',
        windowMs: 60_000,
      },
    };

    await adapter.consume(attempt('primary-one', { rules: primaryRules }));
    await adapter.consume(attempt('primary-two', { rules: primaryRules }));
    await expect(
      adapter.consume(attempt('primary-three', { rules: primaryRules })),
    ).resolves.toMatchObject({ allowed: false });

    await client.flushDb();

    const secondaryRules: HybridRateLimitRules = {
      ...baseRules,
      secondarySlidingWindow: {
        limit: 2,
        name: 'secondary-window',
        windowMs: 60_000,
      },
    };

    await adapter.consume(
      attempt('secondary-one', {
        primarySlidingWindowKey: 'test:{registration}:primary:first',
        rules: secondaryRules,
        tokenBucketKey: 'test:{registration}:bucket:first',
      }),
    );
    await adapter.consume(
      attempt('secondary-two', {
        primarySlidingWindowKey: 'test:{registration}:primary:second',
        rules: secondaryRules,
        tokenBucketKey: 'test:{registration}:bucket:second',
      }),
    );

    await expect(
      adapter.consume(
        attempt('secondary-three', {
          primarySlidingWindowKey: 'test:{registration}:primary:third',
          rules: secondaryRules,
          tokenBucketKey: 'test:{registration}:bucket:third',
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('admits exactly the configured capacity under concurrency', async () => {
    const rules: HybridRateLimitRules = {
      ...baseRules,
      tokenBucket: {
        capacity: 3,
        name: 'ip-burst',
        refillIntervalMs: 60_000,
      },
    };

    const decisions = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        adapter.consume(attempt(`concurrent-${index}`, { rules })),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(7);
  });
});
