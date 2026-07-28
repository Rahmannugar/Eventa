import type { AdminActivationJob } from '@eventa/messaging-contracts/identity/admin-auth.jobs';

import {
  ADMIN_ACTIVATION_MAX_DELIVERY_ATTEMPTS,
  ADMIN_ACTIVATION_RETRY_DELAYS_MS,
} from '../constants/admin-activation-delivery.constants';
import { EmailDeliveryError } from '../errors/email-delivery.errors';
import type { EmailDeliveryProvider } from '../ports/email-delivery.provider';
import { adminActivationTemplate } from '../templates/admin-activation.template';
import type { AuthEmailDeliveryRepository } from '../types/auth-email-delivery.types';
import type { AdminActivationDeliveryOutcome } from '../types/admin-activation-delivery.types';

export class AdminActivationDeliveryService {
  constructor(
    private readonly deliveries: AuthEmailDeliveryRepository,
    private readonly emailDeliveryProvider: EmailDeliveryProvider,
    private readonly from: string,
  ) {}

  async deliver(
    job: AdminActivationJob,
  ): Promise<AdminActivationDeliveryOutcome> {
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
      const content = adminActivationTemplate(job.otp);
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

      return recorded ? { kind: 'delivered' } : this.recoveryRetry();
    } catch (error: unknown) {
      const deliveryError =
        error instanceof EmailDeliveryError
          ? error
          : new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);

      return this.handleFailure(job, claim, deliveryError);
    }
  }

  recordRejected(jobId: string, failureCode: string): Promise<void> {
    return this.deliveries.recordRejected(
      jobId,
      'admin.activation.v1',
      failureCode,
    );
  }

  private async handleFailure(
    job: AdminActivationJob,
    claim: { attempt: number; claimToken: string },
    error: EmailDeliveryError,
  ): Promise<AdminActivationDeliveryOutcome> {
    if (
      !error.retryable ||
      claim.attempt >= ADMIN_ACTIVATION_MAX_DELIVERY_ATTEMPTS
    ) {
      const recorded = await this.deliveries.markFailed(
        job.jobId,
        claim.claimToken,
        error.code,
      );
      return recorded ? { kind: 'failed' } : this.recoveryRetry();
    }

    const delayMs = ADMIN_ACTIVATION_RETRY_DELAYS_MS[claim.attempt - 1];

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

  private recoveryRetry(): AdminActivationDeliveryOutcome {
    const delayMs = ADMIN_ACTIVATION_RETRY_DELAYS_MS.at(-1) ?? 30_000;
    return { kind: 'retry', retryAt: new Date(Date.now() + delayMs) };
  }
}
