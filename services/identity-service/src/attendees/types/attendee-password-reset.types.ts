export interface AttendeePasswordResetAccount {
  attendeeId: string;
  email: string;
}

export interface AttendeePasswordResetRepository {
  findAccountForPasswordReset(
    email: string,
  ): Promise<AttendeePasswordResetAccount | undefined>;
  replacePassword(
    attendeeId: string,
    passwordHash: string,
  ): Promise<boolean>;
}

export interface PasswordResetCode {
  attendeeId: string;
  code: string;
  email: string;
}

export interface PasswordResetCodeRecord {
  attendeeId: string;
  attempts: number;
  codeDigest: string;
  subject: string;
  ttlMs: number;
}

export type PasswordResetClaim =
  | { status: 'claimed'; attendeeId: string }
  | { status: 'completed'; attendeeId: string }
  | { status: 'invalid' };

export interface PasswordResetCooldownDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}
