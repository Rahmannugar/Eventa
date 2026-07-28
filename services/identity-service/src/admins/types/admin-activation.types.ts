export interface AdminActivationAccount {
  adminId: string;
}

export interface AdminActivationRepository {
  findAdminForActivation(
    email: string,
  ): Promise<AdminActivationAccount | undefined>;
  confirmEmail(adminId: string): Promise<boolean>;
  activate(adminId: string, passwordHash: string): Promise<boolean>;
}

export interface AdminActivationOtp {
  adminId: string;
  email: string;
  otp: string;
}

export interface AdminActivationOtpRecord {
  adminId: string;
  attempts: number;
  otpDigest: string;
  subject: string;
  ttlMs: number;
}

export interface AdminActivationRequestDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface AdminActivationOtpState {
  cancel(subject: string): Promise<void>;
  reserveRequest(
    subject: string,
    cooldownMs: number,
  ): Promise<AdminActivationRequestDecision>;
  save(record: AdminActivationOtpRecord): Promise<void>;
  verify(
    subject: string,
    otpDigest: string,
  ): Promise<
    { status: 'invalid' } | { adminId: string; status: 'active' | 'confirmed' }
  >;
  saveGrant(record: {
    adminId: string;
    grantDigest: string;
    subject: string;
    ttlMs: number;
  }): Promise<void>;
  readGrant(
    grantDigest: string,
  ): Promise<{ adminId: string; subject: string } | undefined>;
  completeGrant(grantDigest: string, subject: string): Promise<void>;
}
