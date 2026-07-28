import { runWithOperationSpan } from '@eventa/observability';

import type { RedisClient } from '../../../infrastructure/clients/redis.client';
import type {
  AttendeeSession,
  AttendeeSessionState,
  CreateAttendeeSession,
} from '../../types/attendee-session.types';
import {
  AttendeeSessionAccountBlockedError,
  AttendeeSessionStateUnavailableError,
} from '../../errors/attendee-session.errors';

const CREATE_SESSION_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then
  return { 0, redis.call('GET', KEYS[3]) }
end

local now = redis.call('TIME')
local now_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
local expires_at = now_ms + tonumber(ARGV[4])

local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now_ms)
if #expired > 0 then
  redis.call('DEL', unpack(expired))
  redis.call('ZREM', KEYS[2], unpack(expired))
end

local active_count = redis.call('ZCARD', KEYS[2])
local max_sessions = tonumber(ARGV[5])
local eviction_count = active_count - max_sessions + 1
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
  'attendee_id', ARGV[1],
  'attendee_subject', ARGV[2],
  'session_id', ARGV[3],
  'expires_at', expires_at
)
redis.call('PEXPIREAT', KEYS[1], expires_at)
redis.call('ZADD', KEYS[2], expires_at, KEYS[1])
redis.call('PEXPIREAT', KEYS[2], expires_at)

return { ARGV[3], expires_at }
`;

const PREPARE_ACCOUNT_DELETION_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return -1
end

redis.call('SET', KEYS[2], 'preparing', 'PX', ARGV[1])
local sessions = redis.call('ZRANGE', KEYS[1], 0, -1)
if #sessions > 0 then
  redis.call('DEL', unpack(sessions))
end
redis.call('DEL', KEYS[1])
return #sessions
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

const COMPLETE_ACCOUNT_DELETION_SCRIPT = `
redis.call('SET', KEYS[1], 'deleted', 'PX', ARGV[1])
return 1
`;

const CANCEL_ACCOUNT_DELETION_SCRIPT = `
if redis.call('GET', KEYS[1]) == 'preparing' then
  redis.call('DEL', KEYS[1])
end
return 1
`;

const READ_SESSION_SCRIPT = `
local attendee_id = redis.call('HGET', KEYS[1], 'attendee_id')
if not attendee_id then
  return {}
end

return {
  attendee_id,
  redis.call('HGET', KEYS[1], 'session_id'),
  redis.call('HGET', KEYS[1], 'expires_at')
}
`;

const REVOKE_SESSION_SCRIPT = `
local attendee_subject = redis.call('HGET', KEYS[1], 'attendee_subject')
if not attendee_subject then
  return 0
end

local account_key = ARGV[1] .. attendee_subject
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

const ACCOUNT_KEY_PREFIX = 'identity:attendee-session-account:v1:';

function sessionKey(tokenDigest: string): string {
  return `identity:attendee-session:v1:${tokenDigest}`;
}

function accountKey(attendeeSubject: string): string {
  return `${ACCOUNT_KEY_PREFIX}${attendeeSubject}`;
}

function deletionBarrierKey(attendeeSubject: string): string {
  return `identity:attendee-session-deletion:v1:${attendeeSubject}`;
}

function parseSession(
  result: unknown,
  source: 'create' | 'read',
  attendeeId?: string,
): AttendeeSession | undefined {
  if (!Array.isArray(result)) {
    throw new Error('INVALID_ATTENDEE_SESSION_STATE');
  }

  if (source === 'create' && result.length === 2 && Number(result[0]) === 0) {
    const owner = String(result[1]);
    throw new AttendeeSessionAccountBlockedError(
      owner.startsWith('password-reset:')
        ? 'password-reset'
        : 'account-deletion',
    );
  }

  if (source === 'read' && result.length === 0) {
    return undefined;
  }

  if (result.length !== (source === 'create' ? 2 : 3)) {
    throw new Error('INVALID_ATTENDEE_SESSION_STATE');
  }

  const resolvedAttendeeId =
    source === 'create' ? (attendeeId ?? '') : String(result[0]);
  const sessionId = String(result[source === 'create' ? 0 : 1]);
  const expiresAtMs = Number(result[source === 'create' ? 1 : 2]);
  const expiresAt = new Date(expiresAtMs);

  if (
    resolvedAttendeeId === '' ||
    sessionId === '' ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= 0 ||
    Number.isNaN(expiresAt.getTime())
  ) {
    throw new Error('INVALID_ATTENDEE_SESSION_STATE');
  }

  return {
    attendeeId: resolvedAttendeeId,
    expiresAt,
    sessionId,
  };
}

function parseCount(result: unknown): number {
  const count = Number(result);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('INVALID_ATTENDEE_SESSION_STATE');
  }

  return count;
}

function parseDeletionPreparation(result: unknown): number {
  if (Number(result) === -1) {
    throw new AttendeeSessionAccountBlockedError();
  }

  return parseCount(result);
}

export class RedisAttendeeSessionState implements AttendeeSessionState {
  constructor(private readonly redis: RedisClient) {}

  async create(input: CreateAttendeeSession): Promise<AttendeeSession> {
    try {
      const result = await this.evaluate(
        'attendee_session.create',
        CREATE_SESSION_SCRIPT,
        [
          sessionKey(input.tokenDigest),
          accountKey(input.attendeeSubject),
          deletionBarrierKey(input.attendeeSubject),
        ],
        [
          input.attendeeId,
          input.attendeeSubject,
          input.sessionId,
          String(input.ttlMs),
          String(input.maxConcurrentSessions),
        ],
      );
      const session = parseSession(result, 'create', input.attendeeId);

      if (session === undefined) {
        throw new Error('INVALID_ATTENDEE_SESSION_STATE');
      }

      return session;
    } catch (error: unknown) {
      if (error instanceof AttendeeSessionAccountBlockedError) {
        throw error;
      }

      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async prepareAccountDeletion(
    attendeeSubject: string,
    ttlMs: number,
  ): Promise<number> {
    try {
      const result = await this.evaluate(
        'attendee_session.prepare_account_deletion',
        PREPARE_ACCOUNT_DELETION_SCRIPT,
        [accountKey(attendeeSubject), deletionBarrierKey(attendeeSubject)],
        [String(ttlMs)],
      );

      return parseDeletionPreparation(result);
    } catch (error: unknown) {
      if (error instanceof AttendeeSessionAccountBlockedError) {
        throw error;
      }

      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async completeAccountDeletion(
    attendeeSubject: string,
    ttlMs: number,
  ): Promise<void> {
    try {
      await this.evaluate(
        'attendee_session.complete_account_deletion',
        COMPLETE_ACCOUNT_DELETION_SCRIPT,
        [deletionBarrierKey(attendeeSubject)],
        [String(ttlMs)],
      );
    } catch {
      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async cancelAccountDeletion(attendeeSubject: string): Promise<void> {
    try {
      await this.evaluate(
        'attendee_session.cancel_account_deletion',
        CANCEL_ACCOUNT_DELETION_SCRIPT,
        [deletionBarrierKey(attendeeSubject)],
        [],
      );
    } catch {
      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async cancelPasswordReset(
    attendeeSubject: string,
    resetId: string,
  ): Promise<void> {
    try {
      await this.evaluate(
        'attendee_session.cancel_password_reset',
        CANCEL_PASSWORD_RESET_SCRIPT,
        [deletionBarrierKey(attendeeSubject)],
        [resetId],
      );
    } catch {
      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async read(tokenDigest: string): Promise<AttendeeSession | undefined> {
    try {
      const result = await this.evaluate(
        'attendee_session.read',
        READ_SESSION_SCRIPT,
        [sessionKey(tokenDigest)],
        [],
      );

      return parseSession(result, 'read');
    } catch {
      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async revoke(tokenDigest: string): Promise<boolean> {
    try {
      const result = await this.evaluate(
        'attendee_session.revoke',
        REVOKE_SESSION_SCRIPT,
        [sessionKey(tokenDigest)],
        [ACCOUNT_KEY_PREFIX],
      );

      return parseCount(result) === 1;
    } catch {
      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async revokeAll(attendeeSubject: string): Promise<number> {
    try {
      const result = await this.evaluate(
        'attendee_session.revoke_all',
        REVOKE_ALL_SESSIONS_SCRIPT,
        [accountKey(attendeeSubject)],
        [],
      );

      return parseCount(result);
    } catch {
      throw new AttendeeSessionStateUnavailableError();
    }
  }

  async startPasswordReset(
    attendeeSubject: string,
    resetId: string,
    ttlMs: number,
  ): Promise<number> {
    try {
      const result = await this.evaluate(
        'attendee_session.start_password_reset',
        START_PASSWORD_RESET_SCRIPT,
        [
          accountKey(attendeeSubject),
          deletionBarrierKey(attendeeSubject),
        ],
        [resetId, String(ttlMs)],
      );

      return parseDeletionPreparation(result);
    } catch (error: unknown) {
      if (error instanceof AttendeeSessionAccountBlockedError) {
        throw error;
      }

      throw new AttendeeSessionStateUnavailableError();
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
