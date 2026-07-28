import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisEmailVerificationOtpState } from '../../src/attendees/adapters/redis/email-verification-otp.state';
import { RedisPasswordResetCodeState } from '../../src/attendees/adapters/redis/password-reset-code.state';
import { RedisAttendeeSessionState } from '../../src/attendees/adapters/redis/attendee-session.state';
import { RedisAdminActivationOtpState } from '../../src/admins/adapters/redis/admin-activation-otp.state';
import { RedisAdminSessionState } from '../../src/admins/adapters/redis/admin-session.state';
import { RedisClient } from '../../src/infrastructure/clients/redis.client';
import { AttendeeSessionAccountBlockedError } from '../../src/attendees/errors/attendee-session.errors';

const testRedisUrl = process.env.TEST_REDIS_URL;

if (testRedisUrl === undefined || testRedisUrl.trim() === '') {
  throw new Error('TEST_REDIS_URL is required for integration tests');
}

const administrativeClient = createClient({
  disableOfflineQueue: true,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
  url: testRedisUrl,
});
const redis = new RedisClient(testRedisUrl, 1_000, 750);
const otpState = new RedisEmailVerificationOtpState(redis);
const passwordResetState = new RedisPasswordResetCodeState(redis);
const sessionState = new RedisAttendeeSessionState(redis);
const adminActivationState = new RedisAdminActivationOtpState(redis);
const adminSessionState = new RedisAdminSessionState(redis);

describe('RedisEmailVerificationOtpState integration', () => {
  beforeAll(async () => {
    await administrativeClient.connect();
  });

  beforeEach(async () => {
    await administrativeClient.flushDb();
  });

  afterAll(async () => {
    await redis.onApplicationShutdown();
    await administrativeClient.close();
  });

  it('replaces the previous OTP and gives the replacement its own five guesses', async () => {
    await otpState.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'old-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });
    await otpState.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'new-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });

    await expect(
      otpState.verify('attendee-subject', 'old-digest'),
    ).resolves.toEqual({ status: 'invalid' });
    await expect(
      otpState.verify('attendee-subject', 'new-digest'),
    ).resolves.toEqual({
      attendeeId: 'attendee-1',
      status: 'active',
    });
  });

  it('invalidates an OTP after exactly five incorrect guesses', async () => {
    await otpState.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'correct-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });

    const wrongAttempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        otpState.verify('attendee-subject', 'wrong-digest'),
      ),
    );

    expect(wrongAttempts).toEqual(
      Array.from({ length: 5 }, () => ({ status: 'invalid' })),
    );
    await expect(
      otpState.verify('attendee-subject', 'correct-digest'),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('retains an exact successful replay without extending the OTP lifetime', async () => {
    await otpState.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'correct-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });

    await otpState.markConfirmed('attendee-subject', 'correct-digest');

    await expect(
      otpState.verify('attendee-subject', 'correct-digest'),
    ).resolves.toEqual({
      attendeeId: 'attendee-1',
      status: 'confirmed',
    });
    await expect(
      otpState.verify('attendee-subject', 'wrong-digest'),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('enforces the resend cooldown and allows another resend after expiry', async () => {
    await expect(
      otpState.reserveResend('attendee-subject', 15),
    ).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    await expect(
      otpState.reserveResend('attendee-subject', 15),
    ).resolves.toMatchObject({ allowed: false });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(
      otpState.reserveResend('attendee-subject', 15),
    ).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('admits only one concurrent resend during a cooldown', async () => {
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        otpState.reserveResend('attendee-subject', 60_000),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(1);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(9);
  });

  it('moves admin activation from OTP confirmation to one-time grant cleanup', async () => {
    await adminActivationState.save({
      adminId: 'admin-1',
      attempts: 5,
      otpDigest: 'correct-digest',
      subject: 'admin-subject',
      ttlMs: 60_000,
    });

    await expect(
      adminActivationState.verify('admin-subject', 'correct-digest'),
    ).resolves.toEqual({ adminId: 'admin-1', status: 'active' });
    await expect(
      adminActivationState.verify('admin-subject', 'correct-digest'),
    ).resolves.toEqual({ adminId: 'admin-1', status: 'confirmed' });

    await adminActivationState.saveGrant({
      adminId: 'admin-1',
      grantDigest: 'grant-digest',
      subject: 'admin-subject',
      ttlMs: 60_000,
    });
    await expect(
      adminActivationState.readGrant('grant-digest'),
    ).resolves.toEqual({
      adminId: 'admin-1',
      subject: 'admin-subject',
    });

    await adminActivationState.completeGrant('grant-digest', 'admin-subject');
    await expect(
      adminActivationState.readGrant('grant-digest'),
    ).resolves.toBeUndefined();
    await expect(
      adminActivationState.verify('admin-subject', 'correct-digest'),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('keeps three admin sessions for seven days and removes the oldest fourth-login victim', async () => {
    for (let index = 1; index <= 4; index += 1) {
      await adminSessionState.create({
        adminId: 'admin-1',
        adminSubject: 'admin-subject',
        maxConcurrentSessions: 3,
        sessionId: `session-${String(index)}`,
        tokenDigest: `digest-${String(index)}`,
        ttlMs: 7 * 24 * 60 * 60 * 1_000,
      });
    }

    await expect(
      administrativeClient.exists('identity:admin-session:v1:digest-1'),
    ).resolves.toBe(0);

    for (let index = 2; index <= 4; index += 1) {
      const key = `identity:admin-session:v1:digest-${String(index)}`;
      await expect(administrativeClient.exists(key)).resolves.toBe(1);
      const ttl = await administrativeClient.pTTL(key);
      expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60 * 1_000);
      expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1_000);
    }
  });

  it('keeps session state only for its fixed lifetime', async () => {
    const input = {
      attendeeId: 'attendee-1',
      attendeeSubject: 'subject-1',
      maxConcurrentSessions: 3,
      sessionId: 'session-1',
      tokenDigest: 'a'.repeat(64),
      ttlMs: 500,
    };

    const created = await sessionState.create(input);

    await expect(sessionState.read(input.tokenDigest)).resolves.toEqual(
      created,
    );
    const remainingTtl = await administrativeClient.pTTL(
      `identity:attendee-session:v1:${input.tokenDigest}`,
    );
    expect(remainingTtl).toBeGreaterThan(0);
    expect(remainingTtl).toBeLessThanOrEqual(500);

    await new Promise((resolve) => setTimeout(resolve, 600));
    await expect(sessionState.read(input.tokenDigest)).resolves.toBeUndefined();
  });

  it('silently evicts the oldest session when a fourth is created', async () => {
    const inputs = Array.from({ length: 4 }, (_, index) => ({
      attendeeId: 'attendee-1',
      attendeeSubject: 'subject-1',
      maxConcurrentSessions: 3,
      sessionId: `session-${index + 1}`,
      tokenDigest: String(index + 1)
        .repeat(64)
        .slice(0, 64),
      ttlMs: 60_000,
    }));

    for (const input of inputs) {
      await sessionState.create(input);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    await expect(sessionState.read(inputs[0]!.tokenDigest)).resolves.toBe(
      undefined,
    );
    await expect(
      Promise.all(
        inputs
          .slice(1)
          .map(({ tokenDigest }) => sessionState.read(tokenDigest)),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ sessionId: 'session-2' }),
      expect.objectContaining({ sessionId: 'session-3' }),
      expect.objectContaining({ sessionId: 'session-4' }),
    ]);
  });

  it('atomically preserves the three-session cap under concurrent creation', async () => {
    const inputs = Array.from({ length: 8 }, (_, index) => ({
      attendeeId: 'attendee-1',
      attendeeSubject: 'subject-1',
      maxConcurrentSessions: 3,
      sessionId: `session-${index + 1}`,
      tokenDigest: String(index + 1)
        .repeat(64)
        .slice(0, 64),
      ttlMs: 60_000 + index,
    }));

    await Promise.all(inputs.map((input) => sessionState.create(input)));

    const liveSessions = await Promise.all(
      inputs.map(({ tokenDigest }) => sessionState.read(tokenDigest)),
    );
    expect(liveSessions.filter(Boolean)).toHaveLength(3);
    expect(
      await administrativeClient.zCard(
        'identity:attendee-session-account:v1:subject-1',
      ),
    ).toBe(3);
  });

  it('revokes one session or every session for an attendee', async () => {
    const inputs = ['a', 'b'].map((prefix, index) => ({
      attendeeId: 'attendee-1',
      attendeeSubject: 'subject-1',
      maxConcurrentSessions: 3,
      sessionId: `session-${index + 1}`,
      tokenDigest: prefix.repeat(64),
      ttlMs: 60_000,
    }));
    await Promise.all(inputs.map((input) => sessionState.create(input)));

    await expect(sessionState.revoke(inputs[0]!.tokenDigest)).resolves.toBe(
      true,
    );
    await expect(sessionState.read(inputs[0]!.tokenDigest)).resolves.toBe(
      undefined,
    );
    await expect(sessionState.revokeAll('subject-1')).resolves.toBe(1);
    await expect(sessionState.read(inputs[1]!.tokenDigest)).resolves.toBe(
      undefined,
    );
  });

  it('blocks new sessions while account deletion revokes every existing session', async () => {
    const input = {
      attendeeId: 'attendee-1',
      attendeeSubject: 'subject-1',
      maxConcurrentSessions: 3,
      sessionId: 'session-1',
      tokenDigest: 'd'.repeat(64),
      ttlMs: 60_000,
    };
    await sessionState.create(input);

    await expect(
      sessionState.prepareAccountDeletion('subject-1', 60_000),
    ).resolves.toBe(1);
    await expect(sessionState.read(input.tokenDigest)).resolves.toBeUndefined();
    await expect(
      sessionState.create({
        ...input,
        sessionId: 'session-2',
        tokenDigest: 'e'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(AttendeeSessionAccountBlockedError);
    await expect(
      sessionState.prepareAccountDeletion('subject-1', 60_000),
    ).rejects.toBeInstanceOf(AttendeeSessionAccountBlockedError);

    await sessionState.cancelAccountDeletion('subject-1');
    await expect(
      sessionState.create({
        ...input,
        sessionId: 'session-3',
        tokenDigest: 'f'.repeat(64),
      }),
    ).resolves.toMatchObject({ sessionId: 'session-3' });
  });

  it('exhausts a password reset code after five incorrect guesses', async () => {
    await passwordResetState.save({
      attendeeId: 'attendee-1',
      attempts: 5,
      codeDigest: 'correct-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });

    const wrongAttempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        passwordResetState.claim(
          'attendee-subject',
          'wrong-digest',
          'completion-digest',
        ),
      ),
    );

    expect(wrongAttempts).toEqual(
      Array.from({ length: 5 }, () => ({ status: 'invalid' })),
    );
    await expect(
      passwordResetState.claim(
        'attendee-subject',
        'correct-digest',
        'completion-digest',
      ),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('binds password reset recovery to one exact completion without extending its lifetime', async () => {
    await passwordResetState.save({
      attendeeId: 'attendee-1',
      attempts: 5,
      codeDigest: 'correct-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });
    const key = 'identity:password-reset:{attendee-subject}:state';
    const initialTtl = await administrativeClient.pTTL(key);

    await expect(
      passwordResetState.claim(
        'attendee-subject',
        'correct-digest',
        'completion-one',
      ),
    ).resolves.toEqual({
      attendeeId: 'attendee-1',
      status: 'claimed',
    });
    await expect(
      passwordResetState.claim(
        'attendee-subject',
        'correct-digest',
        'completion-two',
      ),
    ).resolves.toEqual({ status: 'invalid' });

    await passwordResetState.markCompleted(
      'attendee-subject',
      'correct-digest',
      'completion-one',
    );

    await expect(
      passwordResetState.claim(
        'attendee-subject',
        'correct-digest',
        'completion-one',
      ),
    ).resolves.toEqual({
      attendeeId: 'attendee-1',
      status: 'completed',
    });
    expect(await administrativeClient.pTTL(key)).toBeLessThanOrEqual(
      initialTtl,
    );
  });
});
