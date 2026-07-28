import type { EmailVerificationOtp } from '../types/attendee-email-verification.types';
import type { PasswordResetCode } from '../types/attendee-password-reset.types';

export interface AttendeeAuthJobPublisher {
  publishEmailVerification(otp: EmailVerificationOtp): Promise<void>;
  publishPasswordReset(code: PasswordResetCode): Promise<void>;
}
