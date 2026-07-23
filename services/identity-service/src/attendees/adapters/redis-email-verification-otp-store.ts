import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';

import { EMAIL_VERIFICATION_REDIS_CLIENT } from '../constants/attendee-email-verification.constants';
import { EmailVerificationStoreUnavailableError } from '../errors/attendee-email-verification.errors';
import type {
  EmailVerificationOtpMatch,
  EmailVerificationOtpRecord,
  EmailVerificationOtpStore,
  EmailVerificationRedisClient,
  EmailVerificationResendDecision,
} from '../types/attendee-email-verification.types';

const SAVE_OTP_SCRIPT = `
redis.call(
  'HSET',
  KEYS[1],
  'attendee_id', ARGV[1],
  'otp_digest', ARGV[2],
  'attempts_remaining', ARGV[3],
  'status', 'active'
)
redis.call('PEXPIRE', KEYS[1], ARGV[4])

local cooldown_ms = tonumber(ARGV[5])
if cooldown_ms > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', cooldown_ms)
end

return 1
`;

const RESERVE_RESEND_SCRIPT = `
local cooldown_ttl_ms = redis.call('PTTL', KEYS[1])
if cooldown_ttl_ms > 0 then
  return { 0, cooldown_ttl_ms }
end

redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return { 1, 0 }
`;

const CHECK_OTP_SCRIPT = `
local stored_digest = redis.call('HGET', KEYS[1], 'otp_digest')
if not stored_digest then
  return { 0, '' }
end

local status = redis.call('HGET', KEYS[1], 'status')
local attendee_id = redis.call('HGET', KEYS[1], 'attendee_id')

if stored_digest ~= ARGV[1] then
  if status == 'active' then
    local remaining = redis.call('HINCRBY', KEYS[1], 'attempts_remaining', -1)
    if remaining <= 0 then
      redis.call('DEL', KEYS[1])
    end
  end
  return { 0, '' }
end

if status == 'confirmed' then
  return { 2, attendee_id }
end

if status == 'active' then
  return { 1, attendee_id }
end

return { 0, '' }
`;

const MARK_CONFIRMED_SCRIPT = `
local stored_digest = redis.call('HGET', KEYS[1], 'otp_digest')
if stored_digest and stored_digest == ARGV[1] then
  redis.call('HSET', KEYS[1], 'status', 'confirmed')
  return 1
end

return 0
`;

function otpKey(subject: string): string {
  return `identity:email-verification:{${subject}}:otp`;
}

function cooldownKey(subject: string): string {
  return `identity:email-verification:{${subject}}:resend-cooldown`;
}

function parseResendDecision(result: unknown): EmailVerificationResendDecision {
  if (!Array.isArray(result) || result.length !== 2) {
    throw new EmailVerificationStoreUnavailableError();
  }

  const allowedValue = Number(result[0]);
  const retryAfterMs = Number(result[1]);

  if (
    ![0, 1].includes(allowedValue) ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs < 0
  ) {
    throw new EmailVerificationStoreUnavailableError();
  }

  return {
    allowed: allowedValue === 1,
    retryAfterSeconds:
      allowedValue === 1 ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1_000)),
  };
}

function parseOtpMatch(result: unknown): EmailVerificationOtpMatch {
  if (!Array.isArray(result) || result.length !== 2) {
    throw new EmailVerificationStoreUnavailableError();
  }

  const status = Number(result[0]);
  const attendeeId = String(result[1]);

  if (status === 0) {
    return { status: 'invalid' };
  }

  if (attendeeId === '') {
    throw new EmailVerificationStoreUnavailableError();
  }

  if (status === 1) {
    return { attendeeId, status: 'active' };
  }

  if (status === 2) {
    return { attendeeId, status: 'confirmed' };
  }

  throw new EmailVerificationStoreUnavailableError();
}

@Injectable()
export class RedisEmailVerificationOtpStore
  implements EmailVerificationOtpStore, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisEmailVerificationOtpStore.name);
  private connectionAttempt: Promise<void> | undefined;

  constructor(
    @Inject(EMAIL_VERIFICATION_REDIS_CLIENT)
    private readonly client: EmailVerificationRedisClient,
    private readonly operationTimeoutMs: number,
  ) {
    this.client.on('error', (error: Error) => {
      this.logger.error({
        error_type: error.name,
        event: 'email_verification_store_connection_error',
      });
    });
  }

  async saveOtp(
    record: EmailVerificationOtpRecord,
    cooldownMs = 0,
  ): Promise<void> {
    await this.evaluate(
      'email_verification_otp.save',
      SAVE_OTP_SCRIPT,
      [otpKey(record.subject), cooldownKey(record.subject)],
      [
        record.attendeeId,
        record.otpDigest,
        String(record.attempts),
        String(record.ttlMs),
        String(cooldownMs),
      ],
    );
  }

  async reserveResend(
    subject: string,
    cooldownMs: number,
  ): Promise<EmailVerificationResendDecision> {
    const result = await this.evaluate(
      'email_verification_otp.reserve_resend',
      RESERVE_RESEND_SCRIPT,
      [cooldownKey(subject)],
      [String(cooldownMs)],
    );

    return parseResendDecision(result);
  }

  async verify(
    subject: string,
    otpDigest: string,
  ): Promise<EmailVerificationOtpMatch> {
    const result = await this.evaluate(
      'email_verification_otp.verify',
      CHECK_OTP_SCRIPT,
      [otpKey(subject)],
      [otpDigest],
    );

    return parseOtpMatch(result);
  }

  async markConfirmed(subject: string, otpDigest: string): Promise<void> {
    await this.evaluate(
      'email_verification_otp.mark_confirmed',
      MARK_CONFIRMED_SCRIPT,
      [otpKey(subject)],
      [otpDigest],
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
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
          await this.ensureConnected();

          return await this.client
            .withAbortSignal(AbortSignal.timeout(this.operationTimeoutMs))
            .eval(script, { arguments: arguments_, keys });
        } catch (error: unknown) {
          if (error instanceof EmailVerificationStoreUnavailableError) {
            throw error;
          }

          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'email_verification_store_operation_failed',
            operation,
          });
          throw new EmailVerificationStoreUnavailableError();
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
      throw new EmailVerificationStoreUnavailableError();
    }
  }
}
