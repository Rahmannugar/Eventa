import { createHmac, randomInt } from 'node:crypto';

import { Logger } from '@nestjs/common';

import type { PasswordHasher } from '../../security/types/password-hasher.types';
import {
  PASSWORD_RESET_CODE_MAX_GUESSES,
  PASSWORD_RESET_CODE_TTL_MS,
  PASSWORD_RESET_REQUEST_COOLDOWN_MS,
} from '../constants/attendee-password-reset.constants';
import {
  PasswordResetCodeInvalidError,
  PasswordResetRateLimitedError,
} from '../errors/attendee-password-reset.errors';
import type { PasswordResetCodeState } from '../ports/password-reset-code.state';
import type { AttendeeAuthJobPublisher } from '../ports/attendee-auth-job.publisher';
import type { AttendeePasswordResetRepository } from '../types/attendee-password-reset.types';
import type { AttendeeSessionService } from './attendee-session.service';

export class AttendeePasswordResetService {
  private readonly logger = new Logger(AttendeePasswordResetService.name);

  constructor(
    private readonly attendeeAccounts: AttendeePasswordResetRepository,
    private readonly codeState: PasswordResetCodeState,
    private readonly jobPublisher: AttendeeAuthJobPublisher,
    private readonly passwordHasher: PasswordHasher,
    private readonly attendeeSessions: Pick<
      AttendeeSessionService,
      'revokeAll'
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
      attendeeId: account.attendeeId,
      attempts: PASSWORD_RESET_CODE_MAX_GUESSES,
      codeDigest,
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

    const passwordHash = await this.passwordHasher.hash(newPassword);

    await this.attendeeSessions.revokeAll(claim.attendeeId);

    const passwordReplaced = await this.attendeeAccounts.replacePassword(
      claim.attendeeId,
      passwordHash,
    );

    if (!passwordReplaced) {
      throw new PasswordResetCodeInvalidError();
    }

    await this.codeState.markCompleted(subject, codeDigest, completionDigest);

    return { passwordReset: true };
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
