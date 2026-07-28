import type {
  PasswordResetClaim,
  PasswordResetCodeRecord,
  PasswordResetCooldownDecision,
} from '../types/password-reset-state.types';

export interface PasswordResetCodeState {
  cancel(subject: string, codeDigest: string): Promise<void>;
  claim(
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<PasswordResetClaim>;
  markCompleted(
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void>;
  reserve(
    subject: string,
    cooldownMs: number,
  ): Promise<PasswordResetCooldownDecision>;
  save(record: PasswordResetCodeRecord): Promise<void>;
}
