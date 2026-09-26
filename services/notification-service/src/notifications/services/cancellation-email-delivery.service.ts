import {
  EVENT_CANCELLATION_EMAIL_MAX_DELIVERY_ATTEMPTS,
  EVENT_CANCELLATION_EMAIL_RETRY_DELAYS_MS,
} from '../constants/cancellation-email.constants';
import {
  AttendeeContactNotFoundError,
  EventSummaryNotFoundError,
} from '../errors/cancellation-email.errors';
import { EmailDeliveryError } from '../errors/email-delivery.errors';
import type { AttendeeContactProvider } from '../ports/attendee-contact.provider';
import type { EmailDeliveryProvider } from '../ports/email-delivery.provider';
import type {
  EventSummary,
  EventSummaryProvider,
} from '../ports/event-summary.provider';
import { eventCancellationEmailTemplate } from '../templates/cancellation/event-cancellation-email.template';
import type {
  CancellationEmailDeliveryOutcome,
  CancellationEmailDeliveryRepository,
  CancellationEmailJob,
} from '../types/cancellation-email.types';

export class CancellationEmailDeliveryService {
  constructor(
    private readonly deliveries: CancellationEmailDeliveryRepository,
    private readonly attendeeContacts: AttendeeContactProvider,
    private readonly eventSummaries: EventSummaryProvider,
    private readonly emailDeliveryProvider: EmailDeliveryProvider,
    private readonly from: string,
  ) {}

  async deliver(
    job: CancellationEmailJob,
  ): Promise<CancellationEmailDeliveryOutcome> {
    const claim = await this.deliveries.claim(job.deliveryId);

    if (claim.kind === 'terminal') {
      return {
        kind: claim.status === 'delivered' ? 'duplicate' : claim.status,
      };
    }

    if (claim.kind === 'busy') {
      return { kind: 'retry', retryAt: claim.retryAt };
    }

    try {
      const recipient = await this.resolveContact(claim.attendeeId);
      const summary = await this.resolveSummary(claim.eventId);
      const content = eventCancellationEmailTemplate(summary);
      const result = await this.emailDeliveryProvider.send({
        ...content,
        from: this.from,
        idempotencyKey: job.deliveryId,
        to: recipient,
      });
      const recorded = await this.deliveries.markDelivered(
        job.deliveryId,
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

  async recordRejected(deliveryId: string, failureCode: string): Promise<void> {
    await this.deliveries.recordRejected(deliveryId, failureCode);
  }

  private async resolveContact(attendeeId: string): Promise<string> {
    try {
      const contact = await this.attendeeContacts.getContact(attendeeId);
      return contact.email;
    } catch (error: unknown) {
      throw error instanceof AttendeeContactNotFoundError
        ? new EmailDeliveryError('ATTENDEE_CONTACT_NOT_FOUND', false)
        : new EmailDeliveryError('ATTENDEE_CONTACT_UNAVAILABLE', true);
    }
  }

  private async resolveSummary(eventId: string): Promise<EventSummary> {
    try {
      return await this.eventSummaries.getSummary(eventId);
    } catch (error: unknown) {
      throw error instanceof EventSummaryNotFoundError
        ? new EmailDeliveryError('EVENT_SUMMARY_NOT_FOUND', false)
        : new EmailDeliveryError('EVENT_SUMMARY_UNAVAILABLE', true);
    }
  }

  private async handleDeliveryFailure(
    job: CancellationEmailJob,
    claim: { attempt: number; claimToken: string },
    error: EmailDeliveryError,
  ): Promise<CancellationEmailDeliveryOutcome> {
    if (
      !error.retryable ||
      claim.attempt >= EVENT_CANCELLATION_EMAIL_MAX_DELIVERY_ATTEMPTS
    ) {
      const recorded = await this.deliveries.markFailed(
        job.deliveryId,
        claim.claimToken,
        error.code,
      );
      return recorded ? { kind: 'failed' } : this.recoveryRetryOutcome();
    }

    const delayMs = EVENT_CANCELLATION_EMAIL_RETRY_DELAYS_MS[claim.attempt - 1];

    if (delayMs === undefined) {
      const recorded = await this.deliveries.markFailed(
        job.deliveryId,
        claim.claimToken,
        'ATTEMPTS_EXHAUSTED',
      );
      return recorded ? { kind: 'failed' } : this.recoveryRetryOutcome();
    }

    const retryAt = new Date(Date.now() + delayMs);
    const recorded = await this.deliveries.markRetryScheduled(
      job.deliveryId,
      claim.claimToken,
      error.code,
      retryAt,
    );

    return recorded ? { kind: 'retry', retryAt } : this.recoveryRetryOutcome();
  }

  private recoveryRetryOutcome(): CancellationEmailDeliveryOutcome {
    const recoveryDelayMs =
      EVENT_CANCELLATION_EMAIL_RETRY_DELAYS_MS[
        EVENT_CANCELLATION_EMAIL_RETRY_DELAYS_MS.length - 1
      ] ?? 30_000;

    return {
      kind: 'retry',
      retryAt: new Date(Date.now() + recoveryDelayMs),
    };
  }
}
