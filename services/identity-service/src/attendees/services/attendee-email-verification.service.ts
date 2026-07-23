import { createHmac, randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
  EMAIL_VERIFICATION_OTP_MAX_GUESSES,
  EMAIL_VERIFICATION_OTP_STATE,
  EMAIL_VERIFICATION_OTP_TTL_MS,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
} from '../constants/attendee-email-verification.constants';
import {
  EmailVerificationOtpInvalidError,
  EmailVerificationResendRateLimitedError,
} from '../errors/attendee-email-verification.errors';
import type {
  AttendeeEmailVerificationRepository,
  EmailVerificationOtpIssue,
  ResendAttendeeEmailVerificationResult,
} from '../types/attendee-email-verification.types';
import type { EmailVerificationOtpState } from '../ports/email-verification-otp.state';

@Injectable()
export class AttendeeEmailVerificationService {
  constructor(
    @Inject(ATTENDEE_EMAIL_VERIFICATION_REPOSITORY)
    private readonly attendeeAccounts: AttendeeEmailVerificationRepository,
    @Inject(EMAIL_VERIFICATION_OTP_STATE)
    private readonly otpState: EmailVerificationOtpState,
    private readonly hmacSecret: string,
  ) {}

  async issueInitial(
    attendeeId: string,
    email: string,
  ): Promise<EmailVerificationOtpIssue> {
    return this.issue(attendeeId, this.canonicalizeEmail(email), true);
  }

  async resend(email: string): Promise<ResendAttendeeEmailVerificationResult> {
    const canonicalEmail = this.canonicalizeEmail(email);
    const subject = this.protect('subject', canonicalEmail);
    const decision = await this.otpState.reserveResend(
      subject,
      EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
    );

    if (!decision.allowed) {
      throw new EmailVerificationResendRateLimitedError(
        decision.retryAfterSeconds,
      );
    }

    const account = await this.attendeeAccounts.findByEmail(canonicalEmail);

    if (account === undefined || account.emailVerified) {
      return { accepted: true };
    }

    return {
      accepted: true,
      issue: await this.issue(account.attendeeId, canonicalEmail, false),
    };
  }

  async confirm(email: string, otp: string): Promise<{ emailVerified: true }> {
    if (!/^\d{6}$/.test(otp)) {
      throw new EmailVerificationOtpInvalidError();
    }

    const canonicalEmail = this.canonicalizeEmail(email);
    const subject = this.protect('subject', canonicalEmail);
    const otpDigest = this.protect('otp', `${canonicalEmail}:${otp}`);
    const match = await this.otpState.verify(subject, otpDigest);

    if (match.status === 'invalid') {
      throw new EmailVerificationOtpInvalidError();
    }

    if (match.status === 'active') {
      const accountExists = await this.attendeeAccounts.markEmailVerified(
        match.attendeeId,
      );

      if (!accountExists) {
        throw new EmailVerificationOtpInvalidError();
      }

      await this.otpState.markConfirmed(subject, otpDigest);
    }

    return { emailVerified: true };
  }

  private async issue(
    attendeeId: string,
    canonicalEmail: string,
    startResendCooldown: boolean,
  ): Promise<EmailVerificationOtpIssue> {
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const subject = this.protect('subject', canonicalEmail);
    const otpDigest = this.protect('otp', `${canonicalEmail}:${otp}`);

    await this.otpState.saveOtp(
      {
        attendeeId,
        attempts: EMAIL_VERIFICATION_OTP_MAX_GUESSES,
        otpDigest,
        subject,
        ttlMs: EMAIL_VERIFICATION_OTP_TTL_MS,
      },
      startResendCooldown ? EMAIL_VERIFICATION_RESEND_COOLDOWN_MS : 0,
    );

    return { accountId: attendeeId, email: canonicalEmail, otp };
  }

  private canonicalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private protect(purpose: 'otp' | 'subject', value: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(`${purpose}\0${value}`)
      .digest('hex');
  }
}
