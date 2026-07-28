import { runWithOperationSpan } from '@eventa/observability';

import type { RedisClient } from '../../../infrastructure/clients/redis.client';
import { AdminSessionStateUnavailableError } from '../../errors/admin-login.errors';
import type {
  AdminSession,
  AdminSessionState,
} from '../../types/admin-login.types';

const CREATE_SESSION_SCRIPT = `
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

function sessionKey(tokenDigest: string): string {
  return `identity:admin-session:v1:${tokenDigest}`;
}

function accountKey(adminSubject: string): string {
  return `identity:admin-session-account:v1:${adminSubject}`;
}

export class RedisAdminSessionState implements AdminSessionState {
  constructor(private readonly redis: RedisClient) {}

  async create(input: {
    adminId: string;
    adminSubject: string;
    maxConcurrentSessions: number;
    sessionId: string;
    tokenDigest: string;
    ttlMs: number;
  }): Promise<AdminSession> {
    try {
      const result = await runWithOperationSpan(
        'admin_session.create',
        () =>
          this.redis.evaluate(
            CREATE_SESSION_SCRIPT,
            [sessionKey(input.tokenDigest), accountKey(input.adminSubject)],
            [
              input.adminId,
              input.adminSubject,
              input.sessionId,
              String(input.ttlMs),
              String(input.maxConcurrentSessions),
            ],
          ),
        {
          attributes: {
            'db.operation.name': 'EVAL',
            'db.system.name': 'redis',
          },
          kind: 'client',
        },
      );

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
    } catch {
      throw new AdminSessionStateUnavailableError();
    }
  }
}
