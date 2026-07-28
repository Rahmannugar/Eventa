import type { AttendeePasswordResetJob } from '@eventa/messaging-contracts/identity/attendee-auth.jobs';
import { Inject } from '@nestjs/common';

import {
  PASSWORD_RESET_DELIVERY_REPOSITORY,
  PASSWORD_RESET_EMAIL_SENDER,
  PASSWORD_RESET_MAX_DELIVERY_ATTEMPTS,
  PASSWORD_RESET_RETRY_DELAYS_MS,
} from '../constants/password-reset-delivery.constants';
import { EmailDeliveryError } from '../errors/email-delivery.errors';
import type {
  PasswordResetDeliveryOutcome,
  PasswordResetDeliveryRepository,
  PasswordResetEmailSender,
} from '../types/password-reset-delivery.types';

export class PasswordResetDeliveryService {
  constructor(
    @Inject(PASSWORD_RESET_DELIVERY_REPOSITORY)
    private readonly deliveries: PasswordResetDeliveryRepository,
    @Inject(PASSWORD_RESET_EMAIL_SENDER)
    private readonly emailSender: PasswordResetEmailSender,
  ) {}

  async deliver(
    job: AttendeePasswordResetJob,
  ): Promise<PasswordResetDeliveryOutcome> {
    const claim = await this.deliveries.claim(job);

    if (claim.kind === 'terminal') {
      return {
        kind: claim.status === 'delivered' ? 'duplicate' : claim.status,
      };
    }

    if (claim.kind === 'conflict') {
      return { kind: 'rejected' };
    }

    if (claim.kind === 'busy') {
      return { kind: 'retry', retryAt: claim.retryAt };
    }

    try {
      const result = await this.emailSender.send({
        code: job.code,
        jobId: job.jobId,
        recipientEmail: job.recipientEmail,
      });
      const recorded = await this.deliveries.markDelivered(
        job.jobId,
        claim.claimToken,
        result.providerMessageId,
      );

      return recorded ? { kind: 'delivered' } : this.recoveryRetry();
    } catch (error: unknown) {
      const deliveryError =
        error instanceof EmailDeliveryError
          ? error
          : new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);

      return this.handleFailure(job, claim, deliveryError);
    }
  }

  async recordRejected(jobId: string, failureCode: string): Promise<void> {
    await this.deliveries.recordRejected(jobId, failureCode);
  }

  private async handleFailure(
    job: AttendeePasswordResetJob,
    claim: { attempt: number; claimToken: string },
    error: EmailDeliveryError,
  ): Promise<PasswordResetDeliveryOutcome> {
    if (!error.retryable || claim.attempt >= PASSWORD_RESET_MAX_DELIVERY_ATTEMPTS) {
      const recorded = await this.deliveries.markFailed(
        job.jobId,
        claim.claimToken,
        error.code,
      );
      return recorded ? { kind: 'failed' } : this.recoveryRetry();
    }

    const delayMs = PASSWORD_RESET_RETRY_DELAYS_MS[claim.attempt - 1];

    if (delayMs === undefined) {
      const recorded = await this.deliveries.markFailed(
        job.jobId,
        claim.claimToken,
        'ATTEMPTS_EXHAUSTED',
      );
      return recorded ? { kind: 'failed' } : this.recoveryRetry();
    }

    const retryAt = new Date(Date.now() + delayMs);

    if (retryAt.getTime() >= new Date(job.expiresAt).getTime()) {
      const recorded = await this.deliveries.markExpired(
        job.jobId,
        claim.claimToken,
      );
      return recorded ? { kind: 'expired' } : this.recoveryRetry();
    }

    const recorded = await this.deliveries.markRetryScheduled(
      job.jobId,
      claim.claimToken,
      error.code,
      retryAt,
    );

    return recorded ? { kind: 'retry', retryAt } : this.recoveryRetry();
  }

  private recoveryRetry(): PasswordResetDeliveryOutcome {
    const delayMs =
      PASSWORD_RESET_RETRY_DELAYS_MS.at(-1) ?? 30_000;

    return { kind: 'retry', retryAt: new Date(Date.now() + delayMs) };
  }
}
