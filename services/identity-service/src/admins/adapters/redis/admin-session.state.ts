import { runWithOperationSpan } from '@eventa/observability';

import type { RedisClient } from '../../../infrastructure/clients/redis.client';
import {
  AdminSessionAccountBlockedError,
  AdminSessionStateUnavailableError,
} from '../../errors/admin-session.errors';
import type {
  AdminSession,
  AdminSessionState,
  CreateAdminSession,
} from '../../types/admin-session.types';

const CREATE_SESSION_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then
  return { 0 }
end

local now = redis.call('TIME')
local now_us = (tonumber(now[1]) * 1000000) + tonumber(now[2])
local expires_at = math.floor(now_us / 1000) + tonumber(ARGV[4])
local expiry_score = now_us + (tonumber(ARGV[4]) * 1000)

local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now_us)
if #expired > 0 then
  redis.call('DEL', unpack(expired))
  redis.call('ZREM', KEYS[2], unpack(expired))
end

local active_count = redis.call('ZCARD', KEYS[2])
local eviction_count = active_count - tonumber(ARGV[5]) + 1
if eviction_count > 0 then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, eviction_count - 1)
  if #oldest > 0 then
    redis.call('DEL', unpack(oldest))
    redis.call('ZREM', KEYS[2], unpack(oldest))
  end
end

redis.call(
  'HSET',
  KEYS[1],
  'admin_id', ARGV[1],
  'admin_subject', ARGV[2],
  'session_id', ARGV[3],
  'expires_at', expires_at
)
redis.call('PEXPIREAT', KEYS[1], expires_at)
redis.call('ZADD', KEYS[2], expiry_score, KEYS[1])
redis.call('PEXPIREAT', KEYS[2], expires_at)

return { ARGV[3], expires_at }
`;

const START_PASSWORD_RESET_SCRIPT = `
local owner = 'password-reset:' .. ARGV[1]
local current_owner = redis.call('GET', KEYS[2])

if current_owner and current_owner ~= owner then
  return -1
end

redis.call('SET', KEYS[2], owner, 'PX', ARGV[2])
local sessions = redis.call('ZRANGE', KEYS[1], 0, -1)
if #sessions > 0 then
  redis.call('DEL', unpack(sessions))
end
redis.call('DEL', KEYS[1])
return #sessions
`;

const CANCEL_PASSWORD_RESET_SCRIPT = `
if redis.call('GET', KEYS[1]) == 'password-reset:' .. ARGV[1] then
  redis.call('DEL', KEYS[1])
end
return 1
`;

const READ_SESSION_SCRIPT = `
local admin_id = redis.call('HGET', KEYS[1], 'admin_id')
if not admin_id then
  return {}
end

return {
  admin_id,
  redis.call('HGET', KEYS[1], 'session_id'),
  redis.call('HGET', KEYS[1], 'expires_at')
}
`;

const REVOKE_SESSION_SCRIPT = `
local admin_subject = redis.call('HGET', KEYS[1], 'admin_subject')
if not admin_subject then
  return 0
end

local account_key = ARGV[1] .. admin_subject
redis.call('DEL', KEYS[1])
redis.call('ZREM', account_key, KEYS[1])
if redis.call('ZCARD', account_key) == 0 then
  redis.call('DEL', account_key)
end
return 1
`;

const REVOKE_ALL_SESSIONS_SCRIPT = `
local sessions = redis.call('ZRANGE', KEYS[1], 0, -1)
if #sessions > 0 then
  redis.call('DEL', unpack(sessions))
end
redis.call('DEL', KEYS[1])
return #sessions
`;

const ACCOUNT_KEY_PREFIX = 'identity:admin-session-account:v1:';

function sessionKey(tokenDigest: string): string {
  return `identity:admin-session:v1:${tokenDigest}`;
}

function accountKey(adminSubject: string): string {
  return `${ACCOUNT_KEY_PREFIX}${adminSubject}`;
}

function passwordResetKey(adminSubject: string): string {
  return `identity:admin-session-password-reset:v1:${adminSubject}`;
}

export class RedisAdminSessionState implements AdminSessionState {
  constructor(private readonly redis: RedisClient) {}

  async create(input: CreateAdminSession): Promise<AdminSession> {
    try {
      const result = await this.evaluate(
        'admin_session.create',
        CREATE_SESSION_SCRIPT,
        [
          sessionKey(input.tokenDigest),
          accountKey(input.adminSubject),
          passwordResetKey(input.adminSubject),
        ],
        [
          input.adminId,
          input.adminSubject,
          input.sessionId,
          String(input.ttlMs),
          String(input.maxConcurrentSessions),
        ],
      );

      if (
        Array.isArray(result) &&
        result.length === 1 &&
        Number(result[0]) === 0
      ) {
        throw new AdminSessionAccountBlockedError();
      }

      if (!Array.isArray(result) || result.length !== 2) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      const sessionId = String(result[0]);
      const expiresAtMs = Number(result[1]);
      const expiresAt = new Date(expiresAtMs);

      if (
        sessionId === '' ||
        !Number.isSafeInteger(expiresAtMs) ||
        expiresAtMs <= 0 ||
        Number.isNaN(expiresAt.getTime())
      ) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      return { adminId: input.adminId, expiresAt, sessionId };
    } catch (error: unknown) {
      if (error instanceof AdminSessionAccountBlockedError) {
        throw error;
      }

      throw new AdminSessionStateUnavailableError();
    }
  }

  async cancelPasswordReset(
    adminSubject: string,
    resetId: string,
  ): Promise<void> {
    try {
      await this.evaluate(
        'admin_session.cancel_password_reset',
        CANCEL_PASSWORD_RESET_SCRIPT,
        [passwordResetKey(adminSubject)],
        [resetId],
      );
    } catch {
      throw new AdminSessionStateUnavailableError();
    }
  }

  async read(tokenDigest: string): Promise<AdminSession | undefined> {
    try {
      const result = await this.evaluate(
        'admin_session.read',
        READ_SESSION_SCRIPT,
        [sessionKey(tokenDigest)],
        [],
      );

      if (!Array.isArray(result)) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      if (result.length === 0) {
        return undefined;
      }

      if (result.length !== 3) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      const adminId = String(result[0]);
      const sessionId = String(result[1]);
      const expiresAtMs = Number(result[2]);
      const expiresAt = new Date(expiresAtMs);

      if (
        adminId === '' ||
        sessionId === '' ||
        !Number.isSafeInteger(expiresAtMs) ||
        expiresAtMs <= 0 ||
        Number.isNaN(expiresAt.getTime())
      ) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      return { adminId, expiresAt, sessionId };
    } catch {
      throw new AdminSessionStateUnavailableError();
    }
  }

  async revoke(tokenDigest: string): Promise<boolean> {
    try {
      const result = Number(
        await this.evaluate(
          'admin_session.revoke',
          REVOKE_SESSION_SCRIPT,
          [sessionKey(tokenDigest)],
          [ACCOUNT_KEY_PREFIX],
        ),
      );

      if (result !== 0 && result !== 1) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      return result === 1;
    } catch {
      throw new AdminSessionStateUnavailableError();
    }
  }

  async revokeAll(adminSubject: string): Promise<number> {
    try {
      const result = Number(
        await this.evaluate(
          'admin_session.revoke_all',
          REVOKE_ALL_SESSIONS_SCRIPT,
          [accountKey(adminSubject)],
          [],
        ),
      );

      if (!Number.isSafeInteger(result) || result < 0) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      return result;
    } catch {
      throw new AdminSessionStateUnavailableError();
    }
  }

  async startPasswordReset(
    adminSubject: string,
    resetId: string,
    ttlMs: number,
  ): Promise<number> {
    try {
      const result = Number(
        await this.evaluate(
          'admin_session.start_password_reset',
          START_PASSWORD_RESET_SCRIPT,
          [accountKey(adminSubject), passwordResetKey(adminSubject)],
          [resetId, String(ttlMs)],
        ),
      );

      if (result === -1) {
        throw new AdminSessionAccountBlockedError();
      }

      if (!Number.isSafeInteger(result) || result < 0) {
        throw new Error('INVALID_ADMIN_SESSION_STATE');
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof AdminSessionAccountBlockedError) {
        throw error;
      }

      throw new AdminSessionStateUnavailableError();
    }
  }

  private evaluate(
    operation: string,
    script: string,
    keys: string[],
    arguments_: string[],
  ): Promise<unknown> {
    return runWithOperationSpan(
      operation,
      () => this.redis.evaluate(script, keys, arguments_),
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
