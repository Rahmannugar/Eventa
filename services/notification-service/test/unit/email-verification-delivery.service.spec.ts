import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  type AttendeeEmailVerificationJob,
} from '@eventa/messaging-contracts';
import { describe, expect, it } from 'vitest';

import { EmailDeliveryError } from '../../src/notifications/errors/email-delivery.errors';
import { EmailVerificationDeliveryService } from '../../src/notifications/services/email-verification-delivery.service';
import type {
  EmailVerificationDeliveryClaim,
  EmailVerificationDeliveryRepository,
  EmailVerificationEmail,
  EmailVerificationEmailSender,
} from '../../src/notifications/types/email-verification-delivery.types';

const job: AttendeeEmailVerificationJob = {
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  jobId: '9f004a41-8ca1-46f4-b254-2d16dcc88520',
  otp: '123456',
  recipientEmail: 'attendee@example.com',
  type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
};

class RecordingRepository implements EmailVerificationDeliveryRepository {
  claimDecision: EmailVerificationDeliveryClaim = {
    attempt: 1,
    claimToken: '70be399a-4a99-42e2-9d68-e5d1a834c326',
    kind: 'claimed',
  };
  delivered = 0;
  expired = 0;
  failed: string[] = [];
  retries: string[] = [];

  claim(): Promise<EmailVerificationDeliveryClaim> {
    return Promise.resolve(this.claimDecision);
  }

  markDelivered(): Promise<boolean> {
    this.delivered += 1;
    return Promise.resolve(true);
  }

  markExpired(): Promise<boolean> {
    this.expired += 1;
    return Promise.resolve(true);
  }

  markFailed(
    _jobId: string,
    _claimToken: string,
    failureCode: string,
  ): Promise<boolean> {
    this.failed.push(failureCode);
    return Promise.resolve(true);
  }

  markRetryScheduled(
    _jobId: string,
    _claimToken: string,
    failureCode: string,
  ): Promise<boolean> {
    this.retries.push(failureCode);
    return Promise.resolve(true);
  }

  recordRejected(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingSender implements EmailVerificationEmailSender {
  emails: EmailVerificationEmail[] = [];
  error: Error | undefined;

  send(email: EmailVerificationEmail): Promise<{ providerMessageId: string }> {
    this.emails.push(email);

    if (this.error !== undefined) {
      return Promise.reject(this.error);
    }

    return Promise.resolve({ providerMessageId: 'provider-message-1' });
  }
}

function createService(): {
  repository: RecordingRepository;
  sender: RecordingSender;
  service: EmailVerificationDeliveryService;
} {
  const repository = new RecordingRepository();
  const sender = new RecordingSender();
  return {
    repository,
    sender,
    service: new EmailVerificationDeliveryService(repository, sender),
  };
}

describe('EmailVerificationDeliveryService', () => {
  it('sends and records a claimed delivery', async () => {
    const { repository, sender, service } = createService();

    await expect(service.deliver(job)).resolves.toEqual({
      kind: 'delivered',
    });
    expect(sender.emails[0]).toEqual({
      jobId: job.jobId,
      otp: job.otp,
      recipientEmail: job.recipientEmail,
    });
    expect(repository.delivered).toBe(1);
  });

  it('suppresses a durably delivered duplicate', async () => {
    const { repository, sender, service } = createService();
    repository.claimDecision = { kind: 'terminal', status: 'delivered' };

    await expect(service.deliver(job)).resolves.toEqual({
      kind: 'duplicate',
    });
    expect(sender.emails).toHaveLength(0);
  });

  it('schedules a bounded retry for a retryable provider failure', async () => {
    const { repository, sender, service } = createService();
    sender.error = new EmailDeliveryError('EMAIL_PROVIDER_RATE_LIMITED', true);

    await expect(service.deliver(job)).resolves.toMatchObject({
      kind: 'retry',
    });
    expect(repository.retries).toEqual(['EMAIL_PROVIDER_RATE_LIMITED']);
    expect(repository.failed).toHaveLength(0);
  });

  it('records a permanent provider failure without retrying', async () => {
    const { repository, sender, service } = createService();
    sender.error = new EmailDeliveryError(
      'EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT',
      false,
    );

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'failed' });
    expect(repository.failed).toEqual(['EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT']);
    expect(repository.retries).toHaveLength(0);
  });

  it('does not schedule a fourth provider attempt', async () => {
    const { repository, sender, service } = createService();
    repository.claimDecision = {
      attempt: 3,
      claimToken: '70be399a-4a99-42e2-9d68-e5d1a834c326',
      kind: 'claimed',
    };
    sender.error = new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'failed' });
    expect(repository.failed).toEqual(['EMAIL_PROVIDER_UNAVAILABLE']);
    expect(repository.retries).toHaveLength(0);
  });

  it('expires work instead of scheduling a retry beyond the OTP lifetime', async () => {
    const { repository, sender, service } = createService();
    sender.error = new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true);

    await expect(
      service.deliver({
        ...job,
        expiresAt: new Date(Date.now() + 1_000).toISOString(),
      }),
    ).resolves.toEqual({ kind: 'expired' });
    expect(repository.expired).toBe(1);
    expect(repository.retries).toHaveLength(0);
  });
});
