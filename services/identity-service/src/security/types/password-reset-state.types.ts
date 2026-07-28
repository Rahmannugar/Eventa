export interface PasswordResetCodeRecord {
  accountId: string;
  attempts: number;
  codeDigest: string;
  subject: string;
  ttlMs: number;
}

export type PasswordResetClaim =
  | { accountId: string; status: 'claimed' }
  | { accountId: string; status: 'completed' }
  | { status: 'invalid' };

export interface PasswordResetCooldownDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}
