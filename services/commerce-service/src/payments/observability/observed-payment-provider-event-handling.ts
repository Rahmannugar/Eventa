import { recordBusinessOutcome } from '@eventa/observability';

import type { PaymentProviderEventHandling } from '../types/payment-attempt.types';

export class ObservedPaymentProviderEventHandling implements PaymentProviderEventHandling {
  constructor(private readonly events: PaymentProviderEventHandling) {}

  async handle(
    rawBody: Buffer,
    signature: string,
  ): Promise<'processed' | 'ignored' | 'duplicate'> {
    try {
      const outcome = await this.events.handle(rawBody, signature);
      recordBusinessOutcome({
        operation: 'commerce.payment_provider_event',
        outcome,
      });
      return outcome;
    } catch (error: unknown) {
      recordBusinessOutcome({
        operation: 'commerce.payment_provider_event',
        outcome:
          error instanceof Error &&
          error.message === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID'
            ? 'invalid_signature'
            : 'processing_failed',
      });
      throw error;
    }
  }
}
