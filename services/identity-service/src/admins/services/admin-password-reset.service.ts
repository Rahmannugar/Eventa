import { createHmac, randomInt, randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import type { PasswordHasher } from '../../security/types/password-hasher.types';
import { PASSWORD_RESET_SESSION_BLOCK_TTL_MS } from '../../security/constants/security.constants';
import { PasswordResetStateUnavailableError } from '../../security/errors/password-reset.errors';
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
import { AdminSessionAccountBlockedError } from '../errors/admin-session.errors';

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
    private readonly adminSessions: Pick<
      AdminSessionService,
      'cancelPasswordReset' | 'startPasswordReset'
    >,
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
      resetId: randomUUID(),
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

    if (
      await this.adminAccounts.completedPasswordReset(
        claim.accountId,
        claim.resetId,
      )
    ) {
      await this.finishCommittedReset(
        claim.accountId,
        claim.resetId,
        subject,
        codeDigest,
        completionDigest,
      );
      return { passwordReset: true };
    }

    if (claim.status === 'processing') {
      throw new PasswordResetStateUnavailableError();
    }

    try {
      await this.adminSessions.startPasswordReset(
        claim.accountId,
        claim.resetId,
        PASSWORD_RESET_SESSION_BLOCK_TTL_MS,
      );
      const passwordHash = await this.passwordHasher.hash(newPassword);
      const replaced = await this.adminAccounts.replacePassword(
        claim.accountId,
        passwordHash,
        claim.resetId,
      );

      if (!replaced) {
        throw new AdminPasswordResetCodeInvalidError();
      }
    } catch (error: unknown) {
      await this.cancelUncommittedReset(
        claim.accountId,
        claim.resetId,
        subject,
        codeDigest,
        completionDigest,
      );

      if (error instanceof AdminSessionAccountBlockedError) {
        throw new AdminPasswordResetCodeInvalidError();
      }

      throw error;
    }

    await this.finishCommittedReset(
      claim.accountId,
      claim.resetId,
      subject,
      codeDigest,
      completionDigest,
    );

    return { passwordReset: true };
  }

  private async cancelUncommittedReset(
    adminId: string,
    resetId: string,
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void> {
    await Promise.allSettled([
      this.adminSessions.cancelPasswordReset(adminId, resetId),
      this.codeState.releaseClaim(subject, codeDigest, completionDigest),
    ]);
  }

  private async finishCommittedReset(
    adminId: string,
    resetId: string,
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void> {
    const [completion, sessionBlock] = await Promise.allSettled([
      this.codeState.markCompleted(subject, codeDigest, completionDigest),
      this.adminSessions.cancelPasswordReset(adminId, resetId),
    ]);

    if (completion.status === 'rejected') {
      this.logger.error({
        admin_id: adminId,
        error_type:
          completion.reason instanceof Error
            ? completion.reason.name
            : 'UnknownError',
        event: 'admin_password_reset_completion_recovery_required',
      });
    }

    if (sessionBlock.status === 'rejected') {
      this.logger.error({
        admin_id: adminId,
        error_type:
          sessionBlock.reason instanceof Error
            ? sessionBlock.reason.name
            : 'UnknownError',
        event: 'admin_password_reset_session_block_cleanup_failed',
      });
    }
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
