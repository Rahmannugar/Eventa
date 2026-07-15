import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { RATE_LIMIT_REDIS_CLIENT } from '../constants/rate-limit.constants';
import { RateLimitStoreUnavailableError } from '../errors/rate-limit.errors';
import type {
  AtomicRateLimitAttempt,
  RateLimitDecision,
  RateLimitRedisClient,
  RateLimitSnapshot,
  RateLimitStore,
} from '../types/rate-limit.types';

const ATOMIC_RATE_LIMIT_SCRIPT = `
local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)

local capacity = tonumber(ARGV[1])
local refill_interval_ms = tonumber(ARGV[2])
local ip_window_ms = tonumber(ARGV[3])
local ip_limit = tonumber(ARGV[4])
local identity_enabled = tonumber(ARGV[5])
local identity_window_ms = tonumber(ARGV[6])
local identity_limit = tonumber(ARGV[7])
local member = ARGV[8]

local stored_tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local last_refill_ms = tonumber(redis.call('HGET', KEYS[1], 'last_refill_ms'))
local available_tokens = capacity

if stored_tokens and last_refill_ms then
  local elapsed_ms = math.max(0, now_ms - last_refill_ms)
  available_tokens = math.min(capacity, stored_tokens + (elapsed_ms / refill_interval_ms))
end

redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now_ms - ip_window_ms)
local ip_count = redis.call('ZCARD', KEYS[2])

local identity_count = 0
if identity_enabled == 1 then
  redis.call('ZREMRANGEBYSCORE', KEYS[3], 0, now_ms - identity_window_ms)
  identity_count = redis.call('ZCARD', KEYS[3])
end

local retry_after_ms = 0

if available_tokens < 1 then
  retry_after_ms = math.max(retry_after_ms, math.ceil((1 - available_tokens) * refill_interval_ms))
end

if ip_count >= ip_limit then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  retry_after_ms = math.max(retry_after_ms, tonumber(oldest[2]) + ip_window_ms - now_ms)
end

if identity_enabled == 1 and identity_count >= identity_limit then
  local oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  retry_after_ms = math.max(retry_after_ms, tonumber(oldest[2]) + identity_window_ms - now_ms)
end

if retry_after_ms > 0 then
  local token_remaining = math.max(0, math.floor(available_tokens))
  local token_reset_ms = token_remaining == 0
    and math.ceil((1 - available_tokens) * refill_interval_ms)
    or math.ceil((capacity - available_tokens) * refill_interval_ms)
  local ip_remaining = math.max(0, ip_limit - ip_count)
  local ip_oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local ip_reset_ms = ip_count == 0 and ip_window_ms or tonumber(ip_oldest[2]) + ip_window_ms - now_ms
  local identity_remaining = math.max(0, identity_limit - identity_count)
  local identity_reset_ms = 0

  if identity_enabled == 1 then
    local identity_oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
    identity_reset_ms = identity_count == 0 and identity_window_ms or tonumber(identity_oldest[2]) + identity_window_ms - now_ms
  end

  return {
    0,
    math.ceil(retry_after_ms),
    token_remaining,
    math.max(1, math.ceil(token_reset_ms)),
    ip_remaining,
    math.max(1, math.ceil(ip_reset_ms)),
    identity_remaining,
    math.max(0, math.ceil(identity_reset_ms)),
    identity_enabled
  }
end

local consumed_tokens = available_tokens - 1
redis.call('HSET', KEYS[1], 'tokens', consumed_tokens, 'last_refill_ms', now_ms)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity * refill_interval_ms))

redis.call('ZADD', KEYS[2], now_ms, member)
redis.call('PEXPIRE', KEYS[2], ip_window_ms)

if identity_enabled == 1 then
  redis.call('ZADD', KEYS[3], now_ms, member)
  redis.call('PEXPIRE', KEYS[3], identity_window_ms)
end

local token_remaining = math.max(0, math.floor(consumed_tokens))
local token_reset_ms = math.max(1, math.ceil((capacity - consumed_tokens) * refill_interval_ms))
local ip_remaining = math.max(0, ip_limit - (ip_count + 1))
local ip_oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
local ip_reset_ms = math.max(1, tonumber(ip_oldest[2]) + ip_window_ms - now_ms)
local identity_remaining = 0
local identity_reset_ms = 0

if identity_enabled == 1 then
  identity_remaining = math.max(0, identity_limit - (identity_count + 1))
  local identity_oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  identity_reset_ms = math.max(1, tonumber(identity_oldest[2]) + identity_window_ms - now_ms)
end

return {
  1,
  0,
  token_remaining,
  token_reset_ms,
  ip_remaining,
  ip_reset_ms,
  identity_remaining,
  identity_reset_ms,
  identity_enabled
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
  const identityEnabled = readNonNegativeNumber(result, 8) === 1;

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
      attempt.rules.ipSlidingWindow.name,
      attempt.rules.ipSlidingWindow.limit,
      attempt.rules.ipSlidingWindow.windowMs,
      readNonNegativeNumber(result, 4),
      readNonNegativeNumber(result, 5),
    ),
  ];

  if (identityEnabled) {
    limits.push(
      createSnapshot(
        attempt.rules.identitySlidingWindow.name,
        attempt.rules.identitySlidingWindow.limit,
        attempt.rules.identitySlidingWindow.windowMs,
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
    try {
      await this.ensureConnected();

      const identityEnabled = attempt.identityKey === undefined ? 0 : 1;
      const result = await this.client.eval(ATOMIC_RATE_LIMIT_SCRIPT, {
        keys: [
          attempt.tokenBucketKey,
          attempt.ipSlidingWindowKey,
          attempt.identityKey ?? attempt.ipSlidingWindowKey,
        ],
        arguments: [
          String(attempt.rules.tokenBucket.capacity),
          String(attempt.rules.tokenBucket.refillIntervalMs),
          String(attempt.rules.ipSlidingWindow.windowMs),
          String(attempt.rules.ipSlidingWindow.limit),
          String(identityEnabled),
          String(attempt.rules.identitySlidingWindow.windowMs),
          String(attempt.rules.identitySlidingWindow.limit),
          attempt.member,
        ],
      });

      return parseDecision(result, attempt);
    } catch (error: unknown) {
      if (error instanceof RateLimitStoreUnavailableError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Redis rate-limit operation failed: ${message}`);
      throw new RateLimitStoreUnavailableError();
    }
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
