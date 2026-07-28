import { createHmac, randomInt, randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import type { PasswordHasher } from '../../security/types/password-hasher.types';
import { PASSWORD_RESET_SESSION_BLOCK_TTL_MS } from '../../security/constants/security.constants';
import { PasswordResetStateUnavailableError } from '../../security/errors/password-reset.errors';
import {
  PASSWORD_RESET_CODE_MAX_GUESSES,
  PASSWORD_RESET_CODE_TTL_MS,
  PASSWORD_RESET_REQUEST_COOLDOWN_MS,
} from '../constants/attendee-password-reset.constants';
import {
  PasswordResetCodeInvalidError,
  PasswordResetRateLimitedError,
} from '../errors/attendee-password-reset.errors';
import type { PasswordResetCodeState } from '../../security/ports/password-reset-code.state';
import type { AttendeeAuthJobPublisher } from '../ports/attendee-auth-job.publisher';
import type { AttendeePasswordResetRepository } from '../types/attendee-password-reset.types';
import type { AttendeeSessionService } from './attendee-session.service';
import { AttendeeSessionAccountBlockedError } from '../errors/attendee-session.errors';

export class AttendeePasswordResetService {
  private readonly logger = new Logger(AttendeePasswordResetService.name);

  constructor(
    private readonly attendeeAccounts: AttendeePasswordResetRepository,
    private readonly codeState: PasswordResetCodeState,
    private readonly jobPublisher: AttendeeAuthJobPublisher,
    private readonly passwordHasher: PasswordHasher,
    private readonly attendeeSessions: Pick<
      AttendeeSessionService,
      'cancelPasswordReset' | 'startPasswordReset'
    >,
    private readonly hmacSecret: string,
  ) {}

  async forgotPassword(email: string): Promise<{ accepted: true }> {
    const canonicalEmail = this.canonicalizeEmail(email);
    const subject = this.protect('subject', canonicalEmail);
    const decision = await this.codeState.reserve(
      subject,
      PASSWORD_RESET_REQUEST_COOLDOWN_MS,
    );

    if (!decision.allowed) {
      throw new PasswordResetRateLimitedError(decision.retryAfterSeconds);
    }

    const account =
      await this.attendeeAccounts.findAccountForPasswordReset(canonicalEmail);

    if (account === undefined) {
      return { accepted: true };
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeDigest = this.protect('code', `${canonicalEmail}:${code}`);

    await this.codeState.save({
      accountId: account.attendeeId,
      attempts: PASSWORD_RESET_CODE_MAX_GUESSES,
      codeDigest,
      resetId: randomUUID(),
      subject,
      ttlMs: PASSWORD_RESET_CODE_TTL_MS,
    });

    try {
      await this.jobPublisher.publishPasswordReset({
        attendeeId: account.attendeeId,
        code,
        email: account.email,
      });
    } catch (error: unknown) {
      this.logger.error({
        attendee_id: account.attendeeId,
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'password_reset_job_failed',
      });

      try {
        await this.codeState.cancel(subject, codeDigest);
      } catch (cleanupError: unknown) {
        this.logger.error({
          attendee_id: account.attendeeId,
          error_type:
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          event: 'password_reset_state_cleanup_failed',
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
      throw new PasswordResetCodeInvalidError();
    }

    const canonicalEmail = this.canonicalizeEmail(email);
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
      throw new PasswordResetCodeInvalidError();
    }

    if (claim.status === 'completed') {
      return { passwordReset: true };
    }

    if (
      await this.attendeeAccounts.completedPasswordReset(
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
      await this.attendeeSessions.startPasswordReset(
        claim.accountId,
        claim.resetId,
        PASSWORD_RESET_SESSION_BLOCK_TTL_MS,
      );
      const passwordHash = await this.passwordHasher.hash(newPassword);
      const passwordReplaced = await this.attendeeAccounts.replacePassword(
        claim.accountId,
        passwordHash,
        claim.resetId,
      );

      if (!passwordReplaced) {
        throw new PasswordResetCodeInvalidError();
      }
    } catch (error: unknown) {
      await this.cancelUncommittedReset(
        claim.accountId,
        claim.resetId,
        subject,
        codeDigest,
        completionDigest,
      );

      if (error instanceof AttendeeSessionAccountBlockedError) {
        throw new PasswordResetCodeInvalidError();
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
    attendeeId: string,
    resetId: string,
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void> {
    await Promise.allSettled([
      this.attendeeSessions.cancelPasswordReset(attendeeId, resetId),
      this.codeState.releaseClaim(subject, codeDigest, completionDigest),
    ]);
  }

  private async finishCommittedReset(
    attendeeId: string,
    resetId: string,
    subject: string,
    codeDigest: string,
    completionDigest: string,
  ): Promise<void> {
    const [completion, sessionBlock] = await Promise.allSettled([
      this.codeState.markCompleted(subject, codeDigest, completionDigest),
      this.attendeeSessions.cancelPasswordReset(attendeeId, resetId),
    ]);

    if (completion.status === 'rejected') {
      this.logger.error({
        attendee_id: attendeeId,
        error_type:
          completion.reason instanceof Error
            ? completion.reason.name
            : 'UnknownError',
        event: 'attendee_password_reset_completion_recovery_required',
      });
    }

    if (sessionBlock.status === 'rejected') {
      this.logger.error({
        attendee_id: attendeeId,
        error_type:
          sessionBlock.reason instanceof Error
            ? sessionBlock.reason.name
            : 'UnknownError',
        event: 'attendee_password_reset_session_block_cleanup_failed',
      });
    }
  }

  private canonicalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private protect(
    purpose: 'code' | 'completion' | 'subject',
    value: string,
  ): string {
    return createHmac('sha256', this.hmacSecret)
      .update(`attendee-password-reset-${purpose}\0${value}`)
      .digest('hex');
  }
}
