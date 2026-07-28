export interface PasswordResetCodeRecord {
  accountId: string;
  attempts: number;
  codeDigest: string;
  resetId: string;
  subject: string;
  ttlMs: number;
}

export type PasswordResetClaim =
  | {
      accountId: string;
      resetId: string;
      status: 'claimed' | 'completed' | 'processing';
    }
  | { status: 'invalid' };

export interface PasswordResetCooldownDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}
