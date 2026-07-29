import { createHmac, randomInt } from 'node:crypto';

import { Logger } from '@nestjs/common';

import {
  ADMIN_ACTIVATION_OTP_MAX_GUESSES,
  ADMIN_ACTIVATION_OTP_TTL_MS,
  ADMIN_ACTIVATION_REQUEST_COOLDOWN_MS,
} from '../constants/admin-activation.constants';
import {
  AdminActivationOtpInvalidError,
  AdminActivationRateLimitedError,
} from '../errors/admin-activation.errors';
import type { AdminAuthJobPublisher } from '../ports/admin-auth-job.publisher';
import type { PasswordHasher } from '../../security/types/password-hasher.types';
import type {
  AdminActivationOtpState,
  AdminActivationRepository,
} from '../types/admin-activation.types';

export class AdminActivationService {
  private readonly logger = new Logger(AdminActivationService.name);

  constructor(
    private readonly admins: AdminActivationRepository,
    private readonly otpState: AdminActivationOtpState,
    private readonly jobPublisher: Pick<
      AdminAuthJobPublisher,
      'publishActivation'
    >,
    private readonly passwordHasher: PasswordHasher,
    private readonly hmacSecret: string,
  ) {}

  async register(email: string): Promise<{ accepted: true }> {
    const canonicalEmail = email.trim().toLowerCase();
    const subject = this.protect('subject', canonicalEmail);
    const decision = await this.otpState.reserveRequest(
      subject,
      ADMIN_ACTIVATION_REQUEST_COOLDOWN_MS,
    );

    if (!decision.allowed) {
      throw new AdminActivationRateLimitedError(decision.retryAfterSeconds);
    }

    const account = await this.admins.findAdminForActivation(canonicalEmail);

    if (account === undefined) {
      return { accepted: true };
    }

    try {
      const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await this.otpState.save({
        adminId: account.adminId,
        attempts: ADMIN_ACTIVATION_OTP_MAX_GUESSES,
        otpDigest: this.protect('otp', `${canonicalEmail}:${otp}`),
        subject,
        ttlMs: ADMIN_ACTIVATION_OTP_TTL_MS,
      });
      await this.jobPublisher.publishActivation({
        adminId: account.adminId,
        email: canonicalEmail,
        otp,
      });
    } catch (error: unknown) {
      await this.otpState.cancel(subject).catch(() => undefined);
      this.logger.error({
        admin_id: account.adminId,
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'admin_activation_request_failed',
      });
    }

    return { accepted: true };
  }

  async activate(
    email: string,
    otp: string,
    password: string,
  ): Promise<{ activated: true }> {
    if (!/^\d{6}$/.test(otp)) {
      throw new AdminActivationOtpInvalidError();
    }

    const canonicalEmail = email.trim().toLowerCase();
    const subject = this.protect('subject', canonicalEmail);
    const otpDigest = this.protect('otp', `${canonicalEmail}:${otp}`);
    const match = await this.otpState.verify(subject, otpDigest);

    if (match.status === 'invalid') {
      throw new AdminActivationOtpInvalidError();
    }

    const passwordHash = await this.passwordHasher.hash(password);
    const activation = await this.admins.activate(match.adminId, passwordHash);

    if (activation === 'invalid') {
      throw new AdminActivationOtpInvalidError();
    }

    await this.otpState.complete(subject).catch((error: unknown) => {
      this.logger.error({
        admin_id: match.adminId,
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'admin_activation_state_cleanup_failed',
      });
    });

    return { activated: true };
  }

  private protect(purpose: 'otp' | 'subject', value: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(`admin-activation-${purpose}\0${value}`)
      .digest('hex');
  }
}
