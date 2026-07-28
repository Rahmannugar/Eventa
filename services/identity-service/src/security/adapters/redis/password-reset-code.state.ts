import { Logger } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';

import type { RedisClient } from '../../../infrastructure/clients/redis.client';
import { PASSWORD_RESET_CLAIM_LEASE_MS } from '../../constants/security.constants';
import { PasswordResetStateUnavailableError } from '../../errors/password-reset.errors';
import type { PasswordResetCodeState } from '../../ports/password-reset-code.state';
import type {
  PasswordResetClaim,
  PasswordResetCodeRecord,
  PasswordResetCooldownDecision,
} from '../../types/password-reset-state.types';

const RESERVE_SCRIPT = `
local cooldown_ttl_ms = redis.call('PTTL', KEYS[1])
if cooldown_ttl_ms > 0 then
  return { 0, cooldown_ttl_ms }
end

redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return { 1, 0 }
`;

const SAVE_SCRIPT = `
redis.call(
  'HSET',
  KEYS[1],
  'account_id', ARGV[1],
  'code_digest', ARGV[2],
  'attempts_remaining', ARGV[3],
  'reset_id', ARGV[4],
  'status', 'active'
)
redis.call('HDEL', KEYS[1], 'completion_digest', 'processing_until')
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

const CANCEL_SCRIPT = `
local stored_digest = redis.call('HGET', KEYS[1], 'code_digest')
if stored_digest and stored_digest == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
end
return 1
`;

const CLAIM_SCRIPT = `
local stored_digest = redis.call('HGET', KEYS[1], 'code_digest')
if not stored_digest then
  return { 0, '', '' }
end

local status = redis.call('HGET', KEYS[1], 'status')
local account_id = redis.call('HGET', KEYS[1], 'account_id')
local reset_id = redis.call('HGET', KEYS[1], 'reset_id')

if not account_id or not reset_id then
  return { 0, '', '' }
end

if stored_digest ~= ARGV[1] then
  if status == 'active' then
    local remaining = redis.call('HINCRBY', KEYS[1], 'attempts_remaining', -1)
    if remaining <= 0 then
      redis.call('DEL', KEYS[1])
    end
  end
  return { 0, '', '' }
end

local stored_completion = redis.call('HGET', KEYS[1], 'completion_digest')
local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)

if status == 'active' then
  redis.call(
    'HSET',
    KEYS[1],
    'status', 'processing',
    'completion_digest', ARGV[2],
    'processing_until', now_ms + tonumber(ARGV[3])
  )
  return { 1, account_id, reset_id }
end

if status == 'processing' and stored_completion == ARGV[2] then
  local processing_until = tonumber(redis.call('HGET', KEYS[1], 'processing_until') or '0')
  if processing_until > now_ms then
    return { 3, account_id, reset_id }
  end

  redis.call('HSET', KEYS[1], 'processing_until', now_ms + tonumber(ARGV[3]))
  return { 1, account_id, reset_id }
end

if status == 'completed' and stored_completion == ARGV[2] then
  return { 2, account_id, reset_id }
end

return { 0, '', '' }
`;

const MARK_COMPLETED_SCRIPT = `
local stored_code = redis.call('HGET', KEYS[1], 'code_digest')
local stored_completion = redis.call('HGET', KEYS[1], 'completion_digest')
local status = redis.call('HGET', KEYS[1], 'status')

if
  status == 'processing'
  and stored_code == ARGV[1]
  and stored_completion == ARGV[2]
then
  redis.call('HSET', KEYS[1], 'status', 'completed')
  redis.call('HDEL', KEYS[1], 'processing_until')
  return 1
end

return 0
`;

const RELEASE_CLAIM_SCRIPT = `
local stored_code = redis.call('HGET', KEYS[1], 'code_digest')
local stored_completion = redis.call('HGET', KEYS[1], 'completion_digest')
local status = redis.call('HGET', KEYS[1], 'status')

if
  status == 'processing'
  and stored_code == ARGV[1]
  and stored_completion == ARGV[2]
then
  redis.call('HSET', KEYS[1], 'processing_until', '0')
end

return 1
`;

function stateKey(namespace: string, subject: string): string {
  return `identity:${namespace}-password-reset:{${subject}}:state`;
}

function cooldownKey(namespace: string, subject: string): string {
  return `identity:${namespace}-password-reset:{${subject}}:cooldown`;
}

function parseCooldownDecision(result: unknown): PasswordResetCooldownDecision {
  if (!Array.isArray(result) || result.length !== 2) {
    throw new PasswordResetStateUnavailableError();
  }

  const allowed = Number(result[0]);
  const retryAfterMs = Number(result[1]);

  if (
    ![0, 1].includes(allowed) ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0
  ) {
    throw new PasswordResetStateUnavailableError();
  }

  return {
    allowed: allowed === 1,
    retryAfterSeconds:
      allowed === 1 ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
  };
}

function parseClaim(result: unknown): PasswordResetClaim {
  if (!Array.isArray(result) || result.length !== 3) {
    throw new PasswordResetStateUnavailableError();
  }

  const status = Number(result[0]);
  const accountId = String(result[1]);
  const resetId = String(result[2]);

  if (status === 0) {
    return { status: 'invalid' };
  }

  if (accountId === '' || resetId === '') {
    throw new PasswordResetStateUnavailableError();
  }

  if (status === 1) {
    return { accountId, resetId, status: 'claimed' };
  }

  if (status === 2) {
    return { accountId, resetId, status: 'completed' };
  }

  if (status === 3) {
    return { accountId, resetId, status: 'processing' };
  }

  throw new PasswordResetStateUnavailableError();
}

export class RedisPasswordResetCodeState implements PasswordResetCodeState {
  private readonly logger = new Logger(RedisPasswordResetCodeState.name);

  constructor(
    private readonly redis: RedisClient,
    private readonly namespace: 'admin' | 'attendee',
  ) {}

  async reserve(
    subject: string,
    cooldownMs: number,
  ): Promise<PasswordResetCooldownDecision> {
    const result = await this.evaluate(
      'password_reset.reserve',
      RESERVE_SCRIPT,
      [cooldownKey(this.namespace, subject)],
      [String(cooldownMs)],
    );

    return parseCooldownDecision(result);
  }

  async save(record: PasswordResetCodeRecord): Promise<void> {
    await this.evaluate(
      'password_reset.save',
      SAVE_SCRIPT,
      [stateKey(this.namespace, record.subject)],
      [
        record.accountId,
        record.codeDigest,
        String(record.attempts),
        record.resetId,
        String(record.ttlMs),
      ],
    );
  }

  async cancel(subject: string, codeDigest: string): Promise<void> {
    await this.evaluate(
      'password_reset.cancel',
      CANCEL_SCRIPT,
      [stateKey(this.namespace, subject), cooldownKey(this.namespace, subject)],
      [codeDigest],
    );
  }

  async claim(
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<PasswordResetClaim> {
    const result = await this.evaluate(
      'password_reset.claim',
      CLAIM_SCRIPT,
      [stateKey(this.namespace, subject)],
      [
        codeDigest,
        completionDigest,
        String(PASSWORD_RESET_CLAIM_LEASE_MS),
      ],
    );

    return parseClaim(result);
  }

  async markCompleted(
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void> {
    const result = await this.evaluate(
      'password_reset.complete',
      MARK_COMPLETED_SCRIPT,
      [stateKey(this.namespace, subject)],
      [codeDigest, completionDigest],
    );

    if (Number(result) !== 1) {
      throw new PasswordResetStateUnavailableError();
    }
  }

  async releaseClaim(
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void> {
    await this.evaluate(
      'password_reset.release_claim',
      RELEASE_CLAIM_SCRIPT,
      [stateKey(this.namespace, subject)],
      [codeDigest, completionDigest],
    );
  }

  private async evaluate(
    operation: string,
    script: string,
    keys: string[],
    arguments_: string[],
  ): Promise<unknown> {
    return runWithOperationSpan(
      `${this.namespace}_${operation}`,
      async () => {
        try {
          return await this.redis.evaluate(script, keys, arguments_);
        } catch (error: unknown) {
          if (error instanceof PasswordResetStateUnavailableError) {
            throw error;
          }

          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'password_reset_state_operation_failed',
            operation,
          });
          throw new PasswordResetStateUnavailableError();
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
}
