import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  type AttendeeEmailVerificationJob,
} from '@eventa/messaging-contracts/identity/attendee-auth.jobs';
import { describe, expect, it } from 'vitest';

import { EmailDeliveryError } from '../../src/notifications/errors/email-delivery.errors';
import type { EmailDeliveryProvider } from '../../src/notifications/ports/email-delivery.provider';
import { EmailVerificationDeliveryService } from '../../src/notifications/services/email-verification-delivery.service';
import type {
  AuthEmailDeliveryClaim,
  AuthEmailDeliveryRepository,
} from '../../src/notifications/types/auth-email-delivery.types';
import type { EmailDeliveryRequest } from '../../src/notifications/types/email.types';

const job: AttendeeEmailVerificationJob = {
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  jobId: '9f004a41-8ca1-46f4-b254-2d16dcc88520',
  otp: '123456',
  recipientEmail: 'attendee@example.com',
  type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
};

class RecordingRepository implements AuthEmailDeliveryRepository {
  claimDecision: AuthEmailDeliveryClaim = {
    attempt: 1,
    claimToken: '70be399a-4a99-42e2-9d68-e5d1a834c326',
    kind: 'claimed',
  };
  delivered = 0;
  failed: string[] = [];
  retries: string[] = [];

  claim(): Promise<AuthEmailDeliveryClaim> {
    return Promise.resolve(this.claimDecision);
  }

  markDelivered(): Promise<boolean> {
    this.delivered += 1;
    return Promise.resolve(true);
  }

  markExpired(): Promise<boolean> {
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

class RecordingProvider implements EmailDeliveryProvider {
  error: Error | undefined;
  messages: EmailDeliveryRequest[] = [];

  send(email: EmailDeliveryRequest): Promise<{ messageId: string }> {
    this.messages.push(email);

    if (this.error !== undefined) {
      return Promise.reject(this.error);
    }

    return Promise.resolve({ messageId: 'provider-message-1' });
  }
}

function createService(): {
  provider: RecordingProvider;
  repository: RecordingRepository;
  service: EmailVerificationDeliveryService;
} {
  const provider = new RecordingProvider();
  const repository = new RecordingRepository();
  return {
    provider,
    repository,
    service: new EmailVerificationDeliveryService(
      repository,
      provider,
      'Eventa <onboarding@resend.dev>',
    ),
  };
}

describe('email verification delivery', () => {
  it('renders, sends, and records one claimed delivery', async () => {
    const { provider, repository, service } = createService();

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'delivered' });
    expect(provider.messages[0]).toMatchObject({
      from: 'Eventa <onboarding@resend.dev>',
      idempotencyKey: job.jobId,
      subject: 'Verify your Eventa email',
      to: job.recipientEmail,
    });
    expect(provider.messages[0]?.text).toContain(job.otp);
    expect(repository.delivered).toBe(1);
  });

  it('does not send a delivery already recorded as complete', async () => {
    const { provider, repository, service } = createService();
    repository.claimDecision = { kind: 'terminal', status: 'delivered' };

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'duplicate' });
    expect(provider.messages).toHaveLength(0);
  });

  it('schedules retryable provider failures and terminates permanent ones', async () => {
    const retryable = createService();
    retryable.provider.error = new EmailDeliveryError(
      'EMAIL_PROVIDER_RATE_LIMITED',
      true,
    );

    await expect(retryable.service.deliver(job)).resolves.toMatchObject({
      kind: 'retry',
    });
    expect(retryable.repository.retries).toEqual([
      'EMAIL_PROVIDER_RATE_LIMITED',
    ]);

    const permanent = createService();
    permanent.provider.error = new EmailDeliveryError(
      'EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT',
      false,
    );

    await expect(permanent.service.deliver(job)).resolves.toEqual({
      kind: 'failed',
    });
    expect(permanent.repository.failed).toEqual([
      'EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT',
    ]);
  });
});
