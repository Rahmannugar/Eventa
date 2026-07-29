import { Logger } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';

import type { RedisClient } from '../../../infrastructure/clients/redis.client';
import { AdminActivationStateUnavailableError } from '../../errors/admin-activation.errors';
import type {
  AdminActivationOtpState,
  AdminActivationRequestDecision,
  AdminActivationOtpRecord,
} from '../../types/admin-activation.types';

const RESERVE_REQUEST_SCRIPT = `
local cooldown_ttl_ms = redis.call('PTTL', KEYS[1])
if cooldown_ttl_ms > 0 then
  return { 0, cooldown_ttl_ms }
end

redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return { 1, 0 }
`;

const SAVE_OTP_SCRIPT = `
redis.call(
  'HSET',
  KEYS[1],
  'admin_id', ARGV[1],
  'otp_digest', ARGV[2],
  'attempts_remaining', ARGV[3],
  'status', 'active'
)
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1
`;

const CANCEL_SCRIPT = `
redis.call('DEL', KEYS[1], KEYS[2])
return 1
`;

const VERIFY_OTP_SCRIPT = `
local values = redis.call('HMGET', KEYS[1], 'admin_id', 'otp_digest', 'attempts_remaining', 'status')
if not values[1] or not values[2] or not values[3] or not values[4] then
  return { 'invalid' }
end

if values[2] ~= ARGV[1] then
  if values[4] == 'active' then
    local attempts = tonumber(values[3]) - 1
    if attempts <= 0 then
      redis.call('DEL', KEYS[1])
    else
      redis.call('HSET', KEYS[1], 'attempts_remaining', attempts)
    end
  end
  return { 'invalid' }
end

if values[4] == 'active' then
  redis.call('HSET', KEYS[1], 'status', 'confirmed')
end

return { values[4], values[1] }
`;

const COMPLETE_ACTIVATION_SCRIPT = `
redis.call('HSET', KEYS[1], 'status', 'completed')
redis.call('DEL', KEYS[2])
return 1
`;

function otpKey(subject: string): string {
  return `identity:admin-activation:{${subject}}:otp`;
}

function cooldownKey(subject: string): string {
  return `identity:admin-activation:{${subject}}:request-cooldown`;
}

function parseDecision(result: unknown): AdminActivationRequestDecision {
  if (!Array.isArray(result) || result.length !== 2) {
    throw new AdminActivationStateUnavailableError();
  }

  const allowed = Number(result[0]);
  const retryAfterMs = Number(result[1]);

  if (
    ![0, 1].includes(allowed) ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0
  ) {
    throw new AdminActivationStateUnavailableError();
  }

  return {
    allowed: allowed === 1,
    retryAfterSeconds:
      allowed === 1 ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
  };
}

export class RedisAdminActivationOtpState implements AdminActivationOtpState {
  private readonly logger = new Logger(RedisAdminActivationOtpState.name);

  constructor(private readonly redis: RedisClient) {}

  async reserveRequest(
    subject: string,
    cooldownMs: number,
  ): Promise<AdminActivationRequestDecision> {
    return parseDecision(
      await this.evaluate(
        'admin_activation_otp.reserve_request',
        RESERVE_REQUEST_SCRIPT,
        [cooldownKey(subject)],
        [String(cooldownMs)],
      ),
    );
  }

  async save(record: AdminActivationOtpRecord): Promise<void> {
    await this.evaluate(
      'admin_activation_otp.save',
      SAVE_OTP_SCRIPT,
      [otpKey(record.subject)],
      [
        record.adminId,
        record.otpDigest,
        String(record.attempts),
        String(record.ttlMs),
      ],
    );
  }

  async cancel(subject: string): Promise<void> {
    await this.evaluate(
      'admin_activation_otp.cancel',
      CANCEL_SCRIPT,
      [otpKey(subject), cooldownKey(subject)],
      [],
    );
  }

  async verify(
    subject: string,
    otpDigest: string,
  ): Promise<
    | { status: 'invalid' }
    | {
        adminId: string;
        status: 'active' | 'completed' | 'confirmed';
      }
  > {
    const result = await this.evaluate(
      'admin_activation_otp.verify',
      VERIFY_OTP_SCRIPT,
      [otpKey(subject)],
      [otpDigest],
    );

    if (!Array.isArray(result) || result[0] === 'invalid') {
      return { status: 'invalid' };
    }

    const status = String(result[0]);
    const adminId = String(result[1] ?? '');

    if (
      (status !== 'active' &&
        status !== 'confirmed' &&
        status !== 'completed') ||
      adminId.length === 0
    ) {
      throw new AdminActivationStateUnavailableError();
    }

    return { adminId, status };
  }

  async complete(subject: string): Promise<void> {
    await this.evaluate(
      'admin_activation_otp.complete',
      COMPLETE_ACTIVATION_SCRIPT,
      [otpKey(subject), cooldownKey(subject)],
      [],
    );
  }

  private async evaluate(
    operation: string,
    script: string,
    keys: string[],
    arguments_: string[],
  ): Promise<unknown> {
    return runWithOperationSpan(
      operation,
      async () => {
        try {
          return await this.redis.evaluate(script, keys, arguments_);
        } catch (error: unknown) {
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'admin_activation_state_operation_failed',
            operation,
          });
          throw new AdminActivationStateUnavailableError();
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
