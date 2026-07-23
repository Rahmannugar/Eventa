import { describe, expect, it } from 'vitest';

import {
  EMAIL_VERIFICATION_OTP_MAX_GUESSES,
  EMAIL_VERIFICATION_OTP_TTL_MS,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
} from '../../src/attendees/constants/attendee-email-verification.constants';
import {
  EmailVerificationOtpInvalidError,
  EmailVerificationResendRateLimitedError,
} from '../../src/attendees/errors/attendee-email-verification.errors';
import { AttendeeEmailVerificationService } from '../../src/attendees/services/attendee-email-verification.service';
import type {
  AttendeeEmailVerificationAccount,
  AttendeeEmailVerificationRepository,
  EmailVerificationOtpMatch,
  EmailVerificationOtpRecord,
  EmailVerificationOtpStore,
  EmailVerificationResendDecision,
} from '../../src/attendees/types/attendee-email-verification.types';

const HMAC_SECRET = 'unit-test-email-verification-secret-32-characters';

class RecordingRepository implements AttendeeEmailVerificationRepository {
  account: AttendeeEmailVerificationAccount | undefined;
  markResult = true;
  markedAttendeeIds: string[] = [];
  requestedEmails: string[] = [];

  findByEmail(
    email: string,
  ): Promise<AttendeeEmailVerificationAccount | undefined> {
    this.requestedEmails.push(email);
    return Promise.resolve(this.account);
  }

  markEmailVerified(attendeeId: string): Promise<boolean> {
    this.markedAttendeeIds.push(attendeeId);
    return Promise.resolve(this.markResult);
  }
}

class RecordingOtpStore implements EmailVerificationOtpStore {
  savedOtps: Array<{
    cooldownMs: number;
    record: EmailVerificationOtpRecord;
  }> = [];
  match: EmailVerificationOtpMatch = { status: 'invalid' };
  markedConfirmed: Array<{ otpDigest: string; subject: string }> = [];
  resendDecision: EmailVerificationResendDecision = {
    allowed: true,
    retryAfterSeconds: 0,
  };
  resendReservations: Array<{
    cooldownMs: number;
    subject: string;
  }> = [];

  saveOtp(record: EmailVerificationOtpRecord, cooldownMs = 0): Promise<void> {
    this.savedOtps.push({ cooldownMs, record });
    return Promise.resolve();
  }

  reserveResend(
    subject: string,
    cooldownMs: number,
  ): Promise<EmailVerificationResendDecision> {
    this.resendReservations.push({ cooldownMs, subject });
    return Promise.resolve(this.resendDecision);
  }

  verify(): Promise<EmailVerificationOtpMatch> {
    return Promise.resolve(this.match);
  }

  markConfirmed(subject: string, otpDigest: string): Promise<void> {
    this.markedConfirmed.push({ otpDigest, subject });
    return Promise.resolve();
  }
}

function createService(): {
  otpStore: RecordingOtpStore;
  repository: RecordingRepository;
  service: AttendeeEmailVerificationService;
} {
  const repository = new RecordingRepository();
  const otpStore = new RecordingOtpStore();

  return {
    otpStore,
    repository,
    service: new AttendeeEmailVerificationService(
      repository,
      otpStore,
      HMAC_SECRET,
    ),
  };
}

describe('AttendeeEmailVerificationService', () => {
  it('creates a protected six-digit initial OTP with the configured lifetime and guess allowance', async () => {
    const { otpStore, service } = createService();

    const issue = await service.issueInitial(
      'attendee-1',
      '  Attendee@Example.COM ',
    );

    expect(issue).toMatchObject({
      accountId: 'attendee-1',
      email: 'attendee@example.com',
    });
    expect(issue.otp).toMatch(/^\d{6}$/);
    expect(otpStore.savedOtps).toHaveLength(1);
    const savedOtp = otpStore.savedOtps[0];
    expect(savedOtp).toMatchObject({
      cooldownMs: EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
      record: {
        attendeeId: 'attendee-1',
        attempts: EMAIL_VERIFICATION_OTP_MAX_GUESSES,
        ttlMs: EMAIL_VERIFICATION_OTP_TTL_MS,
      },
    });
    expect(savedOtp?.record.subject).toMatch(/^[a-f0-9]{64}$/);
    expect(savedOtp?.record.otpDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(savedOtp?.record.otpDigest).not.toContain(issue.otp);
  });

  it('reserves resend quota before replacing an unverified attendee OTP', async () => {
    const { otpStore, repository, service } = createService();
    repository.account = {
      attendeeId: 'attendee-1',
      emailVerified: false,
    };

    const result = await service.resend('  Attendee@Example.COM ');

    expect(repository.requestedEmails).toEqual(['attendee@example.com']);
    expect(otpStore.resendReservations).toHaveLength(1);
    expect(otpStore.resendReservations[0]?.cooldownMs).toBe(
      EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
    );
    expect(otpStore.resendReservations[0]?.subject).toMatch(/^[a-f0-9]{64}$/);
    expect(result).toMatchObject({
      accepted: true,
      issue: {
        accountId: 'attendee-1',
        email: 'attendee@example.com',
      },
    });
    expect(result.issue?.otp).toMatch(/^\d{6}$/);
    expect(otpStore.savedOtps[0]?.cooldownMs).toBe(0);
  });

  it.each([
    ['unknown attendee', undefined],
    [
      'already verified attendee',
      { attendeeId: 'attendee-1', emailVerified: true },
    ],
  ] as const)('accepts resend generically for an %s', async (_, account) => {
    const { otpStore, repository, service } = createService();
    repository.account = account;

    await expect(service.resend('attendee@example.com')).resolves.toEqual({
      accepted: true,
    });
    expect(otpStore.savedOtps).toHaveLength(0);
  });

  it('rejects a resend while the Redis-owned cooldown is active', async () => {
    const { otpStore, repository, service } = createService();
    otpStore.resendDecision = { allowed: false, retryAfterSeconds: 37 };

    await expect(service.resend('attendee@example.com')).rejects.toEqual(
      new EmailVerificationResendRateLimitedError(37),
    );
    expect(repository.requestedEmails).toHaveLength(0);
  });

  it('marks the account and OTP state after an active OTP matches', async () => {
    const { otpStore, repository, service } = createService();
    otpStore.match = { attendeeId: 'attendee-1', status: 'active' };

    await expect(
      service.confirm('Attendee@Example.COM', '123456'),
    ).resolves.toEqual({ emailVerified: true });
    expect(repository.markedAttendeeIds).toEqual(['attendee-1']);
    expect(otpStore.markedConfirmed).toHaveLength(1);
    expect(otpStore.markedConfirmed[0]?.otpDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(otpStore.markedConfirmed[0]?.subject).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the same success for an exact confirmed OTP replay', async () => {
    const { otpStore, repository, service } = createService();
    otpStore.match = { attendeeId: 'attendee-1', status: 'confirmed' };

    await expect(
      service.confirm('attendee@example.com', '123456'),
    ).resolves.toEqual({ emailVerified: true });
    expect(repository.markedAttendeeIds).toHaveLength(0);
    expect(otpStore.markedConfirmed).toHaveLength(0);
  });

  it('rejects every non-matching or missing OTP through one domain error', async () => {
    const { repository, service } = createService();

    await expect(
      service.confirm('attendee@example.com', '000000'),
    ).rejects.toBeInstanceOf(EmailVerificationOtpInvalidError);
    expect(repository.markedAttendeeIds).toHaveLength(0);
  });

  it('rejects malformed OTPs before reading or changing verification state', async () => {
    const { otpStore, repository, service } = createService();

    await expect(
      service.confirm('attendee@example.com', '12345'),
    ).rejects.toBeInstanceOf(EmailVerificationOtpInvalidError);
    expect(repository.markedAttendeeIds).toHaveLength(0);
    expect(otpStore.markedConfirmed).toHaveLength(0);
  });

  it('uses the same invalid OTP outcome when its attendee no longer exists', async () => {
    const { otpStore, repository, service } = createService();
    otpStore.match = { attendeeId: 'missing-attendee', status: 'active' };
    repository.markResult = false;

    await expect(
      service.confirm('attendee@example.com', '123456'),
    ).rejects.toBeInstanceOf(EmailVerificationOtpInvalidError);
    expect(repository.markedAttendeeIds).toEqual(['missing-attendee']);
    expect(otpStore.markedConfirmed).toHaveLength(0);
  });
});
