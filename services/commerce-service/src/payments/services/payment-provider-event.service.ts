import type {
  PaymentProviderEventHandling,
  PaymentProviderEventRepository,
} from '../types/payment-attempt.types';
import type {
  PaymentProviderPort,
  PaymentWebhookVerifier,
} from '../types/payment-provider.port';
import {
  nextPaymentReconciliationAt,
  resolvePaymentAttemptStatus,
} from './payment-provider-state';

const MAX_WEBHOOK_BODY_BYTES = 100 * 1024;
const MAX_SIGNATURE_LENGTH = 2_048;

export class PaymentProviderEventService implements PaymentProviderEventHandling {
  constructor(
    private readonly attempts: PaymentProviderEventRepository,
    private readonly provider: PaymentProviderPort,
    private readonly verifier: PaymentWebhookVerifier,
  ) {}

  async handle(
    rawBody: Buffer,
    signature: string,
  ): Promise<'processed' | 'ignored' | 'duplicate'> {
    if (
      rawBody.length === 0 ||
      rawBody.length > MAX_WEBHOOK_BODY_BYTES ||
      signature.length === 0 ||
      signature.length > MAX_SIGNATURE_LENGTH
    ) {
      throw new Error('PAYMENT_WEBHOOK_SIGNATURE_INVALID');
    }
    const event = this.verifier.verifyWebhook(rawBody, signature);
    if (event === null) return 'ignored';

    const registration = {
      eventType: event.eventType,
      providerCreatedAt: event.providerCreatedAt,
      providerEventId: event.eventId,
      providerObjectId: event.paymentIntentId,
    };
    const receipt = await this.attempts.registerProviderEvent(registration);
    if (receipt === 'duplicate') return receipt;

    const intent = await this.provider.retrieveIntent(event.paymentIntentId);
    const status = resolvePaymentAttemptStatus(intent);
    return this.attempts.applyProviderEvent({
      ...registration,
      intent,
      reconcileAfter: nextPaymentReconciliationAt(status, new Date()),
      status,
    });
  }
}
