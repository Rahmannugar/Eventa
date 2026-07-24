import type { AttendeeEmailVerificationJob } from '@eventa/messaging-contracts';
import { Inject } from '@nestjs/common';

import {
  EMAIL_VERIFICATION_DELIVERY_REPOSITORY,
  EMAIL_VERIFICATION_EMAIL_SENDER,
  EMAIL_VERIFICATION_MAX_DELIVERY_ATTEMPTS,
  EMAIL_VERIFICATION_RETRY_DELAYS_MS,
} from '../constants/email-verification-delivery.constants';
import { EmailDeliveryError } from '../errors/email-delivery.errors';
import type {
  EmailVerificationDeliveryOutcome,
  EmailVerificationDeliveryRepository,
  EmailVerificationEmailSender,
} from '../types/email-verification-delivery.types';

export class EmailVerificationDeliveryService {
  constructor(
    @Inject(EMAIL_VERIFICATION_DELIVERY_REPOSITORY)
    private readonly deliveries: EmailVerificationDeliveryRepository,
    @Inject(EMAIL_VERIFICATION_EMAIL_SENDER)
    private readonly emailSender: EmailVerificationEmailSender,
  ) {}

  async deliver(
    job: AttendeeEmailVerificationJob,
  ): Promise<EmailVerificationDeliveryOutcome> {
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
        jobId: job.jobId,
        otp: job.otp,
        recipientEmail: job.recipientEmail,
      });
      const recorded = await this.deliveries.markDelivered(
        job.jobId,
        claim.claimToken,
        result.providerMessageId,
      );

      return recorded ? { kind: 'delivered' } : this.recoveryRetryOutcome();
    } catch (error: unknown) {
      const deliveryError =
        error instanceof EmailDeliveryError
          ? error
          : new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);

      return this.handleDeliveryFailure(job, claim, deliveryError);
    }
  }

  async recordRejected(jobId: string, failureCode: string): Promise<void> {
    await this.deliveries.recordRejected(jobId, failureCode);
  }

  private async handleDeliveryFailure(
    job: AttendeeEmailVerificationJob,
    claim: { attempt: number; claimToken: string },
    error: EmailDeliveryError,
  ): Promise<EmailVerificationDeliveryOutcome> {
    if (
      !error.retryable ||
      claim.attempt >= EMAIL_VERIFICATION_MAX_DELIVERY_ATTEMPTS
    ) {
      const recorded = await this.deliveries.markFailed(
        job.jobId,
        claim.claimToken,
        error.code,
      );
      return recorded ? { kind: 'failed' } : this.recoveryRetryOutcome();
    }

    const delayMs = EMAIL_VERIFICATION_RETRY_DELAYS_MS[claim.attempt - 1];

    if (delayMs === undefined) {
      const recorded = await this.deliveries.markFailed(
        job.jobId,
        claim.claimToken,
        'ATTEMPTS_EXHAUSTED',
      );
      return recorded ? { kind: 'failed' } : this.recoveryRetryOutcome();
    }

    const retryAt = new Date(Date.now() + delayMs);

    if (retryAt.getTime() >= new Date(job.expiresAt).getTime()) {
      const recorded = await this.deliveries.markExpired(
        job.jobId,
        claim.claimToken,
      );
      return recorded ? { kind: 'expired' } : this.recoveryRetryOutcome();
    }

    const recorded = await this.deliveries.markRetryScheduled(
      job.jobId,
      claim.claimToken,
      error.code,
      retryAt,
    );

    return recorded ? { kind: 'retry', retryAt } : this.recoveryRetryOutcome();
  }

  private recoveryRetryOutcome(): EmailVerificationDeliveryOutcome {
    const recoveryDelayMs =
      EMAIL_VERIFICATION_RETRY_DELAYS_MS[
        EMAIL_VERIFICATION_RETRY_DELAYS_MS.length - 1
      ] ?? 30_000;

    return {
      kind: 'retry',
      retryAt: new Date(Date.now() + recoveryDelayMs),
    };
  }
}
