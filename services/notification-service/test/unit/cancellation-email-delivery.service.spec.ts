import { describe, expect, it } from 'vitest';

import {
  AttendeeContactNotFoundError,
  EventSummaryNotFoundError,
} from '../../src/notifications/errors/cancellation-email.errors';
import { EmailDeliveryError } from '../../src/notifications/errors/email-delivery.errors';
import type { AttendeeContactProvider } from '../../src/notifications/ports/attendee-contact.provider';
import type { EmailDeliveryProvider } from '../../src/notifications/ports/email-delivery.provider';
import type { EventSummaryProvider } from '../../src/notifications/ports/event-summary.provider';
import { CancellationEmailDeliveryService } from '../../src/notifications/services/cancellation-email-delivery.service';
import type { EmailDeliveryRequest } from '../../src/notifications/types/email.types';
import type {
  CancellationEmailClaim,
  CancellationEmailDeliveryRepository,
  CancellationEmailJob,
} from '../../src/notifications/types/cancellation-email.types';

const job: CancellationEmailJob = {
  deliveryId: '87e8ebdb-4c98-46b5-908c-315c4eab5225',
  type: 'notification.event-cancellation-email.v1',
};

const claim: Extract<CancellationEmailClaim, { kind: 'claimed' }> = {
  attendeeId: '5f4b0d70-3c44-4f6c-9e7f-0f9a2f0d1a21',
  attempt: 1,
  claimToken: '70be399a-4a99-42e2-9d68-e5d1a834c326',
  eventId: '2b4b5f8a-9d1e-4a3c-8a6f-1c2d3e4f5a6b',
  kind: 'claimed',
};

class RecordingRepository implements CancellationEmailDeliveryRepository {
  claimDecision: CancellationEmailClaim = claim;
  delivered = 0;
  failed: string[] = [];
  rejected: string[] = [];
  retries: { failureCode: string; retryAt: Date }[] = [];

  claim(): Promise<CancellationEmailClaim> {
    return Promise.resolve(this.claimDecision);
  }

  markDelivered(): Promise<boolean> {
    this.delivered += 1;
    return Promise.resolve(true);
  }

  markFailed(
    _deliveryId: string,
    _claimToken: string,
    failureCode: string,
  ): Promise<boolean> {
    this.failed.push(failureCode);
    return Promise.resolve(true);
  }

  markRetryScheduled(
    _deliveryId: string,
    _claimToken: string,
    failureCode: string,
    retryAt: Date,
  ): Promise<boolean> {
    this.retries.push({ failureCode, retryAt });
    return Promise.resolve(true);
  }

  recordRejected(_deliveryId: string, failureCode: string): Promise<void> {
    this.rejected.push(failureCode);
    return Promise.resolve();
  }
}

class RecordingContacts implements AttendeeContactProvider {
  error: Error | undefined;

  getContact(attendeeId: string) {
    if (this.error !== undefined) {
      return Promise.reject(this.error);
    }

    return Promise.resolve({
      attendeeId,
      email: 'attendee@example.com',
    });
  }
}

class RecordingSummaries implements EventSummaryProvider {
  error: Error | undefined;

  getSummary(eventId: string) {
    if (this.error !== undefined) {
      return Promise.reject(this.error);
    }

    return Promise.resolve({
      eventId,
      startsAt: '2026-10-12T18:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      title: 'Riverlight Festival',
      venueCity: 'Lisbon',
      venueName: 'Parque das Nações',
    });
  }
}

class RecordingEmailProvider implements EmailDeliveryProvider {
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

function retryFailureCode(retry: { failureCode: string }): string {
  return retry.failureCode;
}

function createService(): {
  contacts: RecordingContacts;
  email: RecordingEmailProvider;
  repository: RecordingRepository;
  service: CancellationEmailDeliveryService;
  summaries: RecordingSummaries;
} {
  const contacts = new RecordingContacts();
  const email = new RecordingEmailProvider();
  const repository = new RecordingRepository();
  const summaries = new RecordingSummaries();

  return {
    contacts,
    email,
    repository,
    service: new CancellationEmailDeliveryService(
      repository,
      contacts,
      summaries,
      email,
      'Eventa <onboarding@resend.dev>',
    ),
    summaries,
  };
}

describe('cancellation email delivery', () => {
  it('claims, resolves the attendee and event, sends, and records the delivery', async () => {
    const { email, repository, service } = createService();

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'delivered' });
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]).toMatchObject({
      from: 'Eventa <onboarding@resend.dev>',
      idempotencyKey: job.deliveryId,
      subject: 'Riverlight Festival has been cancelled',
      to: 'attendee@example.com',
    });
    expect(email.messages[0]?.text).toContain('Riverlight Festival');
    expect(email.messages[0]?.text).toContain('Parque das Nações, Lisbon');
    expect(repository.delivered).toBe(1);
  });

  it('does not send a delivery already recorded as delivered', async () => {
    const { email, repository, service } = createService();
    repository.claimDecision = { kind: 'terminal', status: 'delivered' };

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'duplicate' });
    expect(email.messages).toHaveLength(0);
  });

  it('returns a retry while another delivery attempt holds the lease', async () => {
    const { repository, service } = createService();
    const retryAt = new Date(Date.now() + 5_000);
    repository.claimDecision = { kind: 'busy', retryAt };

    await expect(service.deliver(job)).resolves.toEqual({
      kind: 'retry',
      retryAt,
    });
    expect(repository.retries).toHaveLength(0);
  });

  it('fails permanently when the attendee contact no longer exists', async () => {
    const { contacts, email, repository, service } = createService();
    contacts.error = new AttendeeContactNotFoundError();

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'failed' });
    expect(email.messages).toHaveLength(0);
    expect(repository.failed).toEqual(['ATTENDEE_CONTACT_NOT_FOUND']);
  });

  it('fails permanently when the event summary no longer exists', async () => {
    const { email, repository, service, summaries } = createService();
    summaries.error = new EventSummaryNotFoundError();

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'failed' });
    expect(email.messages).toHaveLength(0);
    expect(repository.failed).toEqual(['EVENT_SUMMARY_NOT_FOUND']);
  });

  it('retries transient contact and event lookup failures', async () => {
    const unavailableContacts = createService();
    unavailableContacts.contacts.error = new Error('UNAVAILABLE');

    await expect(
      unavailableContacts.service.deliver(job),
    ).resolves.toMatchObject({ kind: 'retry' });
    expect(
      unavailableContacts.repository.retries.map(retryFailureCode),
    ).toEqual(['ATTENDEE_CONTACT_UNAVAILABLE']);

    const unavailableSummaries = createService();
    unavailableSummaries.summaries.error = new Error('UNAVAILABLE');

    await expect(
      unavailableSummaries.service.deliver(job),
    ).resolves.toMatchObject({ kind: 'retry' });
    expect(
      unavailableSummaries.repository.retries.map(retryFailureCode),
    ).toEqual(['EVENT_SUMMARY_UNAVAILABLE']);
  });

  it('schedules retryable provider failures and terminates permanent ones', async () => {
    const retryable = createService();
    retryable.email.error = new EmailDeliveryError(
      'EMAIL_PROVIDER_RATE_LIMITED',
      true,
    );

    await expect(retryable.service.deliver(job)).resolves.toMatchObject({
      kind: 'retry',
    });
    expect(retryable.repository.retries.map(retryFailureCode)).toEqual([
      'EMAIL_PROVIDER_RATE_LIMITED',
    ]);

    const permanent = createService();
    permanent.email.error = new EmailDeliveryError(
      'EMAIL_PROVIDER_REJECTED',
      false,
    );

    await expect(permanent.service.deliver(job)).resolves.toEqual({
      kind: 'failed',
    });
    expect(permanent.repository.failed).toEqual(['EMAIL_PROVIDER_REJECTED']);
  });

  it('records the final attempt as failed instead of scheduling another retry', async () => {
    const { email, repository, service } = createService();
    email.error = new EmailDeliveryError('EMAIL_PROVIDER_RATE_LIMITED', true);
    repository.claimDecision = { ...claim, attempt: 3 };

    await expect(service.deliver(job)).resolves.toEqual({ kind: 'failed' });
    expect(repository.retries).toHaveLength(0);
    expect(repository.failed).toEqual(['EMAIL_PROVIDER_RATE_LIMITED']);
  });

  it('retries when the claim was lost before the delivery could be recorded', async () => {
    const { repository, service } = createService();
    repository.markDelivered = () => Promise.resolve(false);

    await expect(service.deliver(job)).resolves.toMatchObject({
      kind: 'retry',
    });
    expect(repository.retries).toHaveLength(0);
  });
});
