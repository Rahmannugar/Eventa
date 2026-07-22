import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';

import { RATE_LIMIT_REDIS_CLIENT } from '../constants/rate-limit.constants';
import { RateLimitStoreUnavailableError } from '../errors/rate-limit.errors';
import type {
  AtomicRateLimitAttempt,
  RateLimitDecision,
  RateLimitRedisClient,
  RateLimitSnapshot,
  RateLimitStore,
} from '../types/rate-limit.types';

const HYBRID_RATE_LIMIT_SCRIPT = `
local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)

local capacity = tonumber(ARGV[1])
local refill_interval_ms = tonumber(ARGV[2])
local primary_window_ms = tonumber(ARGV[3])
local primary_limit = tonumber(ARGV[4])
local secondary_enabled = tonumber(ARGV[5])
local secondary_window_ms = tonumber(ARGV[6])
local secondary_limit = tonumber(ARGV[7])
local member = ARGV[8]

local stored_tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local last_refill_ms = tonumber(redis.call('HGET', KEYS[1], 'last_refill_ms'))
local available_tokens = capacity

if stored_tokens and last_refill_ms then
  local elapsed_ms = math.max(0, now_ms - last_refill_ms)
  available_tokens = math.min(capacity, stored_tokens + (elapsed_ms / refill_interval_ms))
end

redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now_ms - primary_window_ms)
local primary_count = redis.call('ZCARD', KEYS[2])

local secondary_count = 0
if secondary_enabled == 1 then
  redis.call('ZREMRANGEBYSCORE', KEYS[3], 0, now_ms - secondary_window_ms)
  secondary_count = redis.call('ZCARD', KEYS[3])
end

local retry_after_ms = 0

if available_tokens < 1 then
  retry_after_ms = math.max(retry_after_ms, math.ceil((1 - available_tokens) * refill_interval_ms))
end

if primary_count >= primary_limit then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  retry_after_ms = math.max(retry_after_ms, tonumber(oldest[2]) + primary_window_ms - now_ms)
end

if secondary_enabled == 1 and secondary_count >= secondary_limit then
  local oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  retry_after_ms = math.max(retry_after_ms, tonumber(oldest[2]) + secondary_window_ms - now_ms)
end

if retry_after_ms > 0 then
  local token_remaining = math.max(0, math.floor(available_tokens))
  local token_reset_ms = token_remaining == 0
    and math.ceil((1 - available_tokens) * refill_interval_ms)
    or math.ceil((capacity - available_tokens) * refill_interval_ms)
  local primary_remaining = math.max(0, primary_limit - primary_count)
  local primary_oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local primary_reset_ms = primary_count == 0 and primary_window_ms or tonumber(primary_oldest[2]) + primary_window_ms - now_ms
  local secondary_remaining = math.max(0, secondary_limit - secondary_count)
  local secondary_reset_ms = 0

  if secondary_enabled == 1 then
    local secondary_oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
    secondary_reset_ms = secondary_count == 0 and secondary_window_ms or tonumber(secondary_oldest[2]) + secondary_window_ms - now_ms
  end

  return {
    0,
    math.ceil(retry_after_ms),
    token_remaining,
    math.max(1, math.ceil(token_reset_ms)),
    primary_remaining,
    math.max(1, math.ceil(primary_reset_ms)),
    secondary_remaining,
    math.max(0, math.ceil(secondary_reset_ms)),
    secondary_enabled
  }
end

local consumed_tokens = available_tokens - 1
redis.call('HSET', KEYS[1], 'tokens', consumed_tokens, 'last_refill_ms', now_ms)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity * refill_interval_ms))

redis.call('ZADD', KEYS[2], now_ms, member)
redis.call('PEXPIRE', KEYS[2], primary_window_ms)

if secondary_enabled == 1 then
  redis.call('ZADD', KEYS[3], now_ms, member)
  redis.call('PEXPIRE', KEYS[3], secondary_window_ms)
end

local token_remaining = math.max(0, math.floor(consumed_tokens))
local token_reset_ms = math.max(1, math.ceil((capacity - consumed_tokens) * refill_interval_ms))
local primary_remaining = math.max(0, primary_limit - (primary_count + 1))
local primary_oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
local primary_reset_ms = math.max(1, tonumber(primary_oldest[2]) + primary_window_ms - now_ms)
local secondary_remaining = 0
local secondary_reset_ms = 0

if secondary_enabled == 1 then
  secondary_remaining = math.max(0, secondary_limit - (secondary_count + 1))
  local secondary_oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  secondary_reset_ms = math.max(1, tonumber(secondary_oldest[2]) + secondary_window_ms - now_ms)
end

return {
  1,
  0,
  token_remaining,
  token_reset_ms,
  primary_remaining,
  primary_reset_ms,
  secondary_remaining,
  secondary_reset_ms,
  secondary_enabled
}
`;

function readNonNegativeNumber(result: unknown[], index: number): number {
  const value = Number(result[index]);

  if (!Number.isFinite(value) || value < 0) {
    throw new RateLimitStoreUnavailableError();
  }

  return value;
}

function createSnapshot(
  name: string,
  quota: number,
  windowMs: number,
  remaining: number,
  resetAfterMs: number,
): RateLimitSnapshot {
  return {
    name,
    quota,
    remaining: Math.floor(remaining),
    resetAfterSeconds: Math.max(1, Math.ceil(resetAfterMs / 1_000)),
    windowSeconds: Math.ceil(windowMs / 1_000),
  };
}

function parseDecision(
  result: unknown,
  attempt: AtomicRateLimitAttempt,
): RateLimitDecision {
  if (!Array.isArray(result) || result.length !== 9) {
    throw new RateLimitStoreUnavailableError();
  }

  const allowedValue = readNonNegativeNumber(result, 0);
  const retryAfterMs = readNonNegativeNumber(result, 1);
  const secondaryEnabled = readNonNegativeNumber(result, 8) === 1;

  if (![0, 1].includes(allowedValue)) {
    throw new RateLimitStoreUnavailableError();
  }

  const limits = [
    createSnapshot(
      attempt.rules.tokenBucket.name,
      attempt.rules.tokenBucket.capacity,
      attempt.rules.tokenBucket.capacity *
        attempt.rules.tokenBucket.refillIntervalMs,
      readNonNegativeNumber(result, 2),
      readNonNegativeNumber(result, 3),
    ),
    createSnapshot(
      attempt.rules.primarySlidingWindow.name,
      attempt.rules.primarySlidingWindow.limit,
      attempt.rules.primarySlidingWindow.windowMs,
      readNonNegativeNumber(result, 4),
      readNonNegativeNumber(result, 5),
    ),
  ];

  if (secondaryEnabled) {
    limits.push(
      createSnapshot(
        attempt.rules.secondarySlidingWindow.name,
        attempt.rules.secondarySlidingWindow.limit,
        attempt.rules.secondarySlidingWindow.windowMs,
        readNonNegativeNumber(result, 6),
        readNonNegativeNumber(result, 7),
      ),
    );
  }

  const allowed = allowedValue === 1;

  return {
    allowed,
    limits,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
  };
}

@Injectable()
export class RedisRateLimitAdapter
  implements RateLimitStore, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisRateLimitAdapter.name);
  private connectionAttempt: Promise<void> | undefined;

  constructor(
    @Inject(RATE_LIMIT_REDIS_CLIENT)
    private readonly client: RateLimitRedisClient,
  ) {
    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis rate-limit connection error: ${error.message}`);
    });
  }

  async consume(attempt: AtomicRateLimitAttempt): Promise<RateLimitDecision> {
    return runWithOperationSpan(
      'rate_limit.consume',
      async () => {
        try {
          await this.ensureConnected();

          const secondaryEnabled =
            attempt.secondarySlidingWindowKey === undefined ? 0 : 1;
          const result = await this.client.eval(HYBRID_RATE_LIMIT_SCRIPT, {
            keys: [
              attempt.tokenBucketKey,
              attempt.primarySlidingWindowKey,
              attempt.secondarySlidingWindowKey ??
                attempt.primarySlidingWindowKey,
            ],
            arguments: [
              String(attempt.rules.tokenBucket.capacity),
              String(attempt.rules.tokenBucket.refillIntervalMs),
              String(attempt.rules.primarySlidingWindow.windowMs),
              String(attempt.rules.primarySlidingWindow.limit),
              String(secondaryEnabled),
              String(attempt.rules.secondarySlidingWindow.windowMs),
              String(attempt.rules.secondarySlidingWindow.limit),
              attempt.member,
            ],
          });

          return parseDecision(result, attempt);
        } catch (error: unknown) {
          if (error instanceof RateLimitStoreUnavailableError) {
            throw error;
          }

          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'rate_limit_store_operation_failed',
          });
          throw new RateLimitStoreUnavailableError();
        }
      },
      {
        attributes: {
          'db.operation.name': 'EVAL',
          'db.system.name': 'redis',
        },
        kind: 'client',
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) {
      return;
    }

    if (!this.client.isOpen) {
      this.connectionAttempt ??= this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connectionAttempt = undefined;
        });
    }

    if (this.connectionAttempt !== undefined) {
      await this.connectionAttempt;
    }

    if (!this.client.isReady) {
      throw new RateLimitStoreUnavailableError();
    }
  }
}
