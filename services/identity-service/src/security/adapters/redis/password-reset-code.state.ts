import { Logger } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';

import type { RedisClient } from '../../../infrastructure/clients/redis.client';
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
  'status', 'active'
)
redis.call('HDEL', KEYS[1], 'completion_digest')
redis.call('PEXPIRE', KEYS[1], ARGV[4])
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
  return { 0, '' }
end

local status = redis.call('HGET', KEYS[1], 'status')
local account_id = redis.call('HGET', KEYS[1], 'account_id')

if stored_digest ~= ARGV[1] then
  if status == 'active' then
    local remaining = redis.call('HINCRBY', KEYS[1], 'attempts_remaining', -1)
    if remaining <= 0 then
      redis.call('DEL', KEYS[1])
    end
  end
  return { 0, '' }
end

local stored_completion = redis.call('HGET', KEYS[1], 'completion_digest')

if status == 'active' then
  redis.call(
    'HSET',
    KEYS[1],
    'status', 'processing',
    'completion_digest', ARGV[2]
  )
  return { 1, account_id }
end

if status == 'processing' and stored_completion == ARGV[2] then
  return { 1, account_id }
end

if status == 'completed' and stored_completion == ARGV[2] then
  return { 2, account_id }
end

return { 0, '' }
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
  return 1
end

return 0
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
  if (!Array.isArray(result) || result.length !== 2) {
    throw new PasswordResetStateUnavailableError();
  }

  const status = Number(result[0]);
  const accountId = String(result[1]);

  if (status === 0) {
    return { status: 'invalid' };
  }

  if (accountId === '') {
    throw new PasswordResetStateUnavailableError();
  }

  if (status === 1) {
    return { accountId, status: 'claimed' };
  }

  if (status === 2) {
    return { accountId, status: 'completed' };
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
      [codeDigest, completionDigest],
    );

    return parseClaim(result);
  }

  async markCompleted(
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void> {
    await this.evaluate(
      'password_reset.complete',
      MARK_COMPLETED_SCRIPT,
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
