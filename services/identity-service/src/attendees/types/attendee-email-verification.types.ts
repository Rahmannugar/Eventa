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

export interface EmailVerificationOtpIssue {
  accountId: string;
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

export interface EmailVerificationOtpStore {
  markConfirmed(subject: string, otpDigest: string): Promise<void>;
  saveOtp(
    record: EmailVerificationOtpRecord,
    cooldownMs?: number,
  ): Promise<void>;
  reserveResend(
    subject: string,
    cooldownMs: number,
  ): Promise<EmailVerificationResendDecision>;
  verify(
    subject: string,
    otpDigest: string,
  ): Promise<EmailVerificationOtpMatch>;
}

export interface EmailVerificationRedisCommandClient {
  eval(
    script: string,
    options: { arguments: string[]; keys: string[] },
  ): Promise<unknown>;
}

export interface EmailVerificationRedisClient extends EmailVerificationRedisCommandClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  close(): Promise<void>;
  connect(): Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  withAbortSignal(signal: AbortSignal): EmailVerificationRedisCommandClient;
}

export interface ResendAttendeeEmailVerificationResult {
  accepted: true;
  issue?: EmailVerificationOtpIssue;
}
