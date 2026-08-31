export interface ProviderPaymentIntent {
  paymentIntentId: string;
  clientSecret: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  metadata: Record<string, string>;
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
