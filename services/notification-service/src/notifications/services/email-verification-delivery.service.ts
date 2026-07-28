import type { AttendeeEmailVerificationJob } from '@eventa/messaging-contracts/identity/attendee-auth.jobs';

import {
  EMAIL_VERIFICATION_MAX_DELIVERY_ATTEMPTS,
  EMAIL_VERIFICATION_RETRY_DELAYS_MS,
} from '../constants/email-verification-delivery.constants';
import { EmailDeliveryError } from '../errors/email-delivery.errors';
import type { EmailDeliveryProvider } from '../ports/email-delivery.provider';
import { attendeeEmailVerificationTemplate } from '../templates/auth/attendee-email-verification.template';
import type { AuthEmailDeliveryRepository } from '../types/auth-email-delivery.types';
import type { EmailVerificationDeliveryOutcome } from '../types/email-verification-delivery.types';

export class EmailVerificationDeliveryService {
  constructor(
    private readonly deliveries: AuthEmailDeliveryRepository,
    private readonly emailDeliveryProvider: EmailDeliveryProvider,
    private readonly from: string,
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
      const content = attendeeEmailVerificationTemplate(job.otp);
      const result = await this.emailDeliveryProvider.send({
        ...content,
        from: this.from,
        idempotencyKey: job.jobId,
        to: job.recipientEmail,
      });
      const recorded = await this.deliveries.markDelivered(
        job.jobId,
        claim.claimToken,
        result.messageId,
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
    await this.deliveries.recordRejected(
      jobId,
      'attendee.email-verification.v1',
      failureCode,
    );
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
