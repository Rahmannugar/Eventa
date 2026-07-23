import type { EmailVerificationOtp } from '../types/attendee-email-verification.types';

export interface EmailVerificationJobPublisher {
  publish(otp: EmailVerificationOtp): Promise<void>;
}
