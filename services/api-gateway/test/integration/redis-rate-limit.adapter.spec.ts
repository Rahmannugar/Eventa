import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisRateLimitAdapter } from '../../src/rate-limit/adapters/redis-rate-limit.adapter';
import type {
  AtomicRateLimitAttempt,
  AttendeeRegistrationRateLimitRules,
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

const baseRules: AttendeeRegistrationRateLimitRules = {
  routeKey: 'integration-test',
  tokenBucket: {
    capacity: 100,
    name: 'ip-burst',
    refillIntervalMs: 60_000,
  },
  ipSlidingWindow: { limit: 100, name: 'ip-window', windowMs: 60_000 },
  identitySlidingWindow: {
    limit: 100,
    name: 'identity-window',
    windowMs: 60_000,
  },
};

function attempt(
  member: string,
  overrides: Partial<AtomicRateLimitAttempt> = {},
): AtomicRateLimitAttempt {
  return {
    identityKey: 'test:{registration}:identity:one',
    ipSlidingWindowKey: 'test:{registration}:ip:one',
    member,
    rules: baseRules,
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
    const rules: AttendeeRegistrationRateLimitRules = {
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

  it('enforces IP and identity sliding windows independently', async () => {
    const ipRules: AttendeeRegistrationRateLimitRules = {
      ...baseRules,
      ipSlidingWindow: {
        limit: 2,
        name: 'ip-window',
        windowMs: 60_000,
      },
    };

    await adapter.consume(attempt('ip-one', { rules: ipRules }));
    await adapter.consume(attempt('ip-two', { rules: ipRules }));
    await expect(
      adapter.consume(attempt('ip-three', { rules: ipRules })),
    ).resolves.toMatchObject({ allowed: false });

    await client.flushDb();

    const identityRules: AttendeeRegistrationRateLimitRules = {
      ...baseRules,
      identitySlidingWindow: {
        limit: 2,
        name: 'identity-window',
        windowMs: 60_000,
      },
    };

    await adapter.consume(
      attempt('identity-one', {
        ipSlidingWindowKey: 'test:{registration}:ip:first',
        rules: identityRules,
        tokenBucketKey: 'test:{registration}:bucket:first',
      }),
    );
    await adapter.consume(
      attempt('identity-two', {
        ipSlidingWindowKey: 'test:{registration}:ip:second',
        rules: identityRules,
        tokenBucketKey: 'test:{registration}:bucket:second',
      }),
    );

    await expect(
      adapter.consume(
        attempt('identity-three', {
          ipSlidingWindowKey: 'test:{registration}:ip:third',
          rules: identityRules,
          tokenBucketKey: 'test:{registration}:bucket:third',
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('admits exactly the configured capacity under concurrency', async () => {
    const rules: AttendeeRegistrationRateLimitRules = {
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
