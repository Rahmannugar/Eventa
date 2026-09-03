import Stripe from 'stripe';

import type {
  CreateProviderPaymentIntentCommand,
  PaymentProviderPort,
  PaymentWebhookVerifier,
  ProviderPaymentEvent,
  ProviderPaymentIntent,
} from '../types/payment-provider.port';

const PAYMENT_INTENT_EVENTS = new Set([
  'payment_intent.canceled',
  'payment_intent.created',
  'payment_intent.payment_failed',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.succeeded',
]);

export class StripePaymentProviderAdapter
  implements PaymentProviderPort, PaymentWebhookVerifier
{
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(options: {
    secretKey: string;
    webhookSecret: string;
    timeoutMs: number;
    maxNetworkRetries: number;
  }) {
    this.webhookSecret = options.webhookSecret;
    this.stripe = new Stripe(options.secretKey, {
      maxNetworkRetries: options.maxNetworkRetries,
      timeout: options.timeoutMs,
      typescript: true,
    });
  }

  verifyWebhook(
    rawBody: Buffer,
    signature: string,
  ): ProviderPaymentEvent | null {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (error: unknown) {
      throw new Error('PAYMENT_WEBHOOK_SIGNATURE_INVALID', { cause: error });
    }
    if (!PAYMENT_INTENT_EVENTS.has(event.type)) return null;
    const object = event.data.object;
    if (object.object !== 'payment_intent') {
      throw new Error('PAYMENT_WEBHOOK_EVENT_INVALID');
    }
    return {
      eventId: event.id,
      eventType: event.type,
      paymentIntentId: object.id,
      providerCreatedAt: new Date(event.created * 1_000),
    };
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
      hasLastPaymentError: intent.last_payment_error !== null,
      metadata: intent.metadata,
      paymentIntentId: intent.id,
      status: intent.status,
    };
  }
}
