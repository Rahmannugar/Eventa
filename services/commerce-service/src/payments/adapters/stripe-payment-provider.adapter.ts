import Stripe from 'stripe';

import type {
  CreateProviderPaymentIntentCommand,
  PaymentProviderPort,
  ProviderPaymentIntent,
} from '../types/payment-provider.port';

export class StripePaymentProviderAdapter implements PaymentProviderPort {
  private readonly stripe: Stripe;

  constructor(options: {
    secretKey: string;
    timeoutMs: number;
    maxNetworkRetries: number;
  }) {
    this.stripe = new Stripe(options.secretKey, {
      maxNetworkRetries: options.maxNetworkRetries,
      timeout: options.timeoutMs,
      typescript: true,
    });
  }

  async createIntent(
    input: CreateProviderPaymentIntentCommand,
  ): Promise<ProviderPaymentIntent> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: input.amountMinor,
          automatic_payment_methods: { enabled: true },
          currency: input.currency.toLowerCase(),
          metadata: {
            eventa_order_id: input.orderId,
            eventa_payment_id: input.paymentId,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return this.toIntent(intent);
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new Error('PAYMENT_PROVIDER_REJECTED', { cause: error });
      }
      throw new Error('PAYMENT_PROVIDER_UNAVAILABLE', { cause: error });
    }
  }

  async retrieveIntent(
    paymentIntentId: string,
  ): Promise<ProviderPaymentIntent> {
    try {
      return this.toIntent(
        await this.stripe.paymentIntents.retrieve(paymentIntentId),
      );
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new Error('PAYMENT_PROVIDER_REJECTED', { cause: error });
      }
      throw new Error('PAYMENT_PROVIDER_UNAVAILABLE', { cause: error });
    }
  }

  private toIntent(intent: Stripe.PaymentIntent): ProviderPaymentIntent {
    return {
      amountMinor: intent.amount,
      clientSecret: intent.client_secret,
      currency: intent.currency.toUpperCase(),
      metadata: intent.metadata,
      paymentIntentId: intent.id,
      status: intent.status,
    };
  }
}
