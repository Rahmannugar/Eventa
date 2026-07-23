import { createClient } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RedisEmailVerificationOtpStore } from '../../src/attendees/adapters/redis-email-verification-otp-store';

const testRedisUrl = process.env.TEST_REDIS_URL;

if (testRedisUrl === undefined || testRedisUrl.trim() === '') {
  throw new Error('TEST_REDIS_URL is required for integration tests');
}

const client = createClient({
  disableOfflineQueue: true,
  socket: { connectTimeout: 1_000, reconnectStrategy: false },
  url: testRedisUrl,
});
const store = new RedisEmailVerificationOtpStore(client, 750);

describe('RedisEmailVerificationOtpStore integration', () => {
  beforeAll(async () => {
    await client.connect();
  });

  beforeEach(async () => {
    await client.flushDb();
  });

  afterAll(async () => {
    await store.onApplicationShutdown();
  });

  it('replaces the previous OTP and gives the replacement its own five guesses', async () => {
    await store.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'old-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });
    await store.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'new-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });

    await expect(
      store.verify('attendee-subject', 'old-digest'),
    ).resolves.toEqual({ status: 'invalid' });
    await expect(
      store.verify('attendee-subject', 'new-digest'),
    ).resolves.toEqual({
      attendeeId: 'attendee-1',
      status: 'active',
    });
  });

  it('invalidates an OTP after exactly five incorrect guesses', async () => {
    await store.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'correct-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });

    const wrongAttempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        store.verify('attendee-subject', 'wrong-digest'),
      ),
    );

    expect(wrongAttempts).toEqual(
      Array.from({ length: 5 }, () => ({ status: 'invalid' })),
    );
    await expect(
      store.verify('attendee-subject', 'correct-digest'),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('retains an exact successful replay without extending the OTP lifetime', async () => {
    await store.saveOtp({
      attendeeId: 'attendee-1',
      attempts: 5,
      otpDigest: 'correct-digest',
      subject: 'attendee-subject',
      ttlMs: 60_000,
    });

    await store.markConfirmed('attendee-subject', 'correct-digest');

    await expect(
      store.verify('attendee-subject', 'correct-digest'),
    ).resolves.toEqual({
      attendeeId: 'attendee-1',
      status: 'confirmed',
    });
    await expect(
      store.verify('attendee-subject', 'wrong-digest'),
    ).resolves.toEqual({ status: 'invalid' });
  });

  it('enforces the resend cooldown and allows another resend after expiry', async () => {
    await expect(store.reserveResend('attendee-subject', 15)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    await expect(
      store.reserveResend('attendee-subject', 15),
    ).resolves.toMatchObject({ allowed: false });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(store.reserveResend('attendee-subject', 15)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('admits only one concurrent resend during a cooldown', async () => {
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.reserveResend('attendee-subject', 60_000),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(1);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(9);
  });
});
