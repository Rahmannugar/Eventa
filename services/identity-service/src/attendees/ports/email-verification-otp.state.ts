import type {
  EmailVerificationOtpMatch,
  EmailVerificationOtpRecord,
  EmailVerificationResendDecision,
} from '../types/attendee-email-verification.types';

export interface EmailVerificationOtpState {
  markConfirmed(subject: string, otpDigest: string): Promise<void>;
  reserveResend(
    subject: string,
    cooldownMs: number,
  ): Promise<EmailVerificationResendDecision>;
  saveOtp(
    record: EmailVerificationOtpRecord,
    cooldownMs?: number,
  ): Promise<void>;
  verify(
    subject: string,
    otpDigest: string,
  ): Promise<EmailVerificationOtpMatch>;
}
