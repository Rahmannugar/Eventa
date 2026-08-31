import { randomUUID } from 'node:crypto';

import type {
  PaymentAttemptRepository,
  PaymentConfirmation,
  PaymentManagement,
  PreparePaymentCommand,
} from '../types/payment-attempt.types';
import type {
  PaymentProviderPort,
  ProviderPaymentIntent,
} from '../types/payment-provider.port';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const PROVIDER_STATUSES = new Set([
  'canceled',
  'processing',
  'requires_action',
  'requires_capture',
  'requires_confirmation',
  'requires_payment_method',
  'succeeded',
]);

export class PaymentAttemptService implements PaymentManagement {
  constructor(
    private readonly attempts: PaymentAttemptRepository,
    private readonly provider: PaymentProviderPort,
  ) {}

  async prepare(input: PreparePaymentCommand): Promise<PaymentConfirmation> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error('PAYMENT_AMOUNT_NOT_PAYABLE');
    }
    if (!CURRENCY_PATTERN.test(input.currency)) {
      throw new Error('PAYMENT_CURRENCY_INVALID');
    }

    const paymentId = randomUUID();
    const attempt = await this.attempts.createPending({
      ...input,
      paymentId,
      providerIdempotencyKey: `eventa-payment:${paymentId}`,
    });
    const intent =
      attempt.providerPaymentIntentId === null
        ? await this.provider.createIntent({
            amountMinor: attempt.amountMinor,
            currency: attempt.currency,
            idempotencyKey: attempt.providerIdempotencyKey,
            orderId: attempt.orderId,
            paymentId: attempt.paymentId,
          })
        : await this.provider.retrieveIntent(attempt.providerPaymentIntentId);

    const clientSecret = this.validateIntent(attempt, intent);
    await this.attempts.markAwaitingConfirmation({
      paymentId: attempt.paymentId,
      providerPaymentIntentId: intent.paymentIntentId,
      providerStatus: intent.status,
    });
    return {
      clientSecret,
      paymentId: attempt.paymentId,
    };
  }

  private validateIntent(
    attempt: Awaited<ReturnType<PaymentAttemptRepository['createPending']>>,
    intent: ProviderPaymentIntent,
  ): string {
    if (
      !PAYMENT_INTENT_PATTERN.test(intent.paymentIntentId) ||
      intent.clientSecret === null ||
      intent.clientSecret.trim() === '' ||
      intent.clientSecret.length > 512 ||
      !intent.clientSecret.startsWith(`${intent.paymentIntentId}_secret_`) ||
      !Number.isSafeInteger(intent.amountMinor) ||
      intent.amountMinor !== attempt.amountMinor ||
      intent.currency.toUpperCase() !== attempt.currency ||
      !PROVIDER_STATUSES.has(intent.status) ||
      intent.metadata.eventa_order_id !== attempt.orderId ||
      intent.metadata.eventa_payment_id !== attempt.paymentId
    ) {
      throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');
    }
    return intent.clientSecret;
  }
}
