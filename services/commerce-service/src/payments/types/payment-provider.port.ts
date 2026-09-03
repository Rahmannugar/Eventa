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

export interface ProviderRefund {
  refundId: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  status: string;
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
  cancelIntent?(paymentIntentId: string): Promise<ProviderPaymentIntent>;
  createRefund?(input: { paymentIntentId: string; idempotencyKey: string }): Promise<ProviderRefund>;
  retrieveRefund?(refundId: string): Promise<ProviderRefund>;
}

export interface PaymentWebhookVerifier {
  verifyWebhook(
    rawBody: Buffer,
    signature: string,
  ): ProviderPaymentEvent | null;
}
