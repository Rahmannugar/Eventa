export interface ProviderPaymentIntent {
  paymentIntentId: string;
  clientSecret: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  hasLastPaymentError: boolean;
  metadata: Record<string, string>;
}

export interface ProviderPaymentEvent {
  eventId: string;
  eventType: string;
  paymentIntentId: string;
  providerCreatedAt: Date;
}

export interface CreateProviderPaymentIntentCommand {
  amountMinor: number;
  currency: string;
  orderId: string;
  paymentId: string;
  idempotencyKey: string;
}

export interface PaymentProviderPort {
  createIntent(
    input: CreateProviderPaymentIntentCommand,
  ): Promise<ProviderPaymentIntent>;
  retrieveIntent(paymentIntentId: string): Promise<ProviderPaymentIntent>;
}

export interface PaymentWebhookVerifier {
  verifyWebhook(
    rawBody: Buffer,
    signature: string,
  ): ProviderPaymentEvent | null;
}
