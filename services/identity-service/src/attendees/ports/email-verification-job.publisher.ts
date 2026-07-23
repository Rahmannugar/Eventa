import type { EmailVerificationOtpIssue } from '../types/attendee-email-verification.types';

export interface EmailVerificationJobPublisher {
  publish(issue: EmailVerificationOtpIssue): Promise<void>;
}
