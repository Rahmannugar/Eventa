import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisEmailVerificationOtpState } from '../../src/attendees/adapters/redis/email-verification-otp.state';
import { RedisClient } from '../../src/infrastructure/clients/redis.client';

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
});
