export interface AttendeeEmailVerificationAccount {
  attendeeId: string;
  emailVerified: boolean;
}

export interface AttendeeEmailVerificationRepository {
  findByEmail(
    email: string,
  ): Promise<AttendeeEmailVerificationAccount | undefined>;
  markEmailVerified(attendeeId: string): Promise<boolean>;
}

export interface EmailVerificationOtpRecord {
  attendeeId: string;
  attempts: number;
  otpDigest: string;
  subject: string;
  ttlMs: number;
}

export interface EmailVerificationOtp {
  attendeeId: string;
  email: string;
  otp: string;
}

export type EmailVerificationOtpMatch =
  | { status: 'active'; attendeeId: string }
  | { status: 'confirmed'; attendeeId: string }
  | { status: 'invalid' };

export interface EmailVerificationResendDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ResendAttendeeEmailVerificationResult {
  accepted: true;
}
