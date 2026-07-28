import { createHmac, randomInt } from 'node:crypto';

import { Logger } from '@nestjs/common';

import type { PasswordHasher } from '../../security/types/password-hasher.types';
import type { PasswordResetCodeState } from '../../security/ports/password-reset-code.state';
import {
  ADMIN_PASSWORD_RESET_CODE_MAX_GUESSES,
  ADMIN_PASSWORD_RESET_CODE_TTL_MS,
  ADMIN_PASSWORD_RESET_REQUEST_COOLDOWN_MS,
} from '../constants/admin-password-reset.constants';
import {
  AdminPasswordResetCodeInvalidError,
  AdminPasswordResetRateLimitedError,
} from '../errors/admin-password-reset.errors';
import type { AdminAuthJobPublisher } from '../ports/admin-auth-job.publisher';
import type { AdminPasswordResetRepository } from '../types/admin-password-reset.types';
import type { AdminSessionService } from './admin-session.service';

export class AdminPasswordResetService {
  private readonly logger = new Logger(AdminPasswordResetService.name);

  constructor(
    private readonly adminAccounts: AdminPasswordResetRepository,
    private readonly codeState: PasswordResetCodeState,
    private readonly jobPublisher: Pick<
      AdminAuthJobPublisher,
      'publishPasswordReset'
    >,
    private readonly passwordHasher: PasswordHasher,
    private readonly adminSessions: Pick<AdminSessionService, 'revokeAll'>,
    private readonly hmacSecret: string,
  ) {}

  async forgotPassword(email: string): Promise<{ accepted: true }> {
    const canonicalEmail = email.trim().toLowerCase();
    const subject = this.protect('subject', canonicalEmail);
    const decision = await this.codeState.reserve(
      subject,
      ADMIN_PASSWORD_RESET_REQUEST_COOLDOWN_MS,
    );

    if (!decision.allowed) {
      throw new AdminPasswordResetRateLimitedError(decision.retryAfterSeconds);
    }

    const account =
      await this.adminAccounts.findActivatedForPasswordReset(canonicalEmail);

    if (account === undefined) {
      return { accepted: true };
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeDigest = this.protect('code', `${canonicalEmail}:${code}`);

    await this.codeState.save({
      accountId: account.adminId,
      attempts: ADMIN_PASSWORD_RESET_CODE_MAX_GUESSES,
      codeDigest,
      subject,
      ttlMs: ADMIN_PASSWORD_RESET_CODE_TTL_MS,
    });

    try {
      await this.jobPublisher.publishPasswordReset({
        adminId: account.adminId,
        code,
        email: account.email,
      });
    } catch (error: unknown) {
      this.logger.error({
        admin_id: account.adminId,
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'admin_password_reset_job_failed',
      });

      try {
        await this.codeState.cancel(subject, codeDigest);
      } catch (cleanupError: unknown) {
        this.logger.error({
          admin_id: account.adminId,
          error_type:
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          event: 'admin_password_reset_state_cleanup_failed',
        });
      }
    }

    return { accepted: true };
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ passwordReset: true }> {
    if (!/^\d{6}$/.test(code)) {
      throw new AdminPasswordResetCodeInvalidError();
    }

    const canonicalEmail = email.trim().toLowerCase();
    const subject = this.protect('subject', canonicalEmail);
    const codeDigest = this.protect('code', `${canonicalEmail}:${code}`);
    const completionDigest = this.protect(
      'completion',
      `${canonicalEmail}:${code}:${newPassword}`,
    );
    const claim = await this.codeState.claim(
      subject,
      codeDigest,
      completionDigest,
    );

    if (claim.status === 'invalid') {
      throw new AdminPasswordResetCodeInvalidError();
    }

    if (claim.status === 'completed') {
      return { passwordReset: true };
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.adminSessions.revokeAll(claim.accountId);

    const replaced = await this.adminAccounts.replacePassword(
      claim.accountId,
      passwordHash,
    );

    if (!replaced) {
      throw new AdminPasswordResetCodeInvalidError();
    }

    await this.codeState.markCompleted(subject, codeDigest, completionDigest);

    return { passwordReset: true };
  }

  private protect(
    purpose: 'code' | 'completion' | 'subject',
    value: string,
  ): string {
    return createHmac('sha256', this.hmacSecret)
      .update(`admin-password-reset-${purpose}\0${value}`)
      .digest('hex');
  }
}
