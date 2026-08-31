export type PaymentAttemptStatus = 'provider_pending' | 'awaiting_confirmation';

export interface PaymentAttemptRecord {
  paymentId: string;
  orderId: string;
  attendeeId: string;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
  provider: 'stripe';
  providerIdempotencyKey: string;
  providerPaymentIntentId: string | null;
  providerStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentAttemptCommand {
  paymentId: string;
  orderId: string;
  attendeeId: string;
  amountMinor: number;
  currency: string;
  providerIdempotencyKey: string;
}

export interface PaymentAttemptRepository {
  createPending(
    input: CreatePaymentAttemptCommand,
  ): Promise<PaymentAttemptRecord>;
  markAwaitingConfirmation(input: {
    paymentId: string;
    providerPaymentIntentId: string;
    providerStatus: string;
  }): Promise<PaymentAttemptRecord>;
}

export interface PaymentConfirmation {
  paymentId: string;
  clientSecret: string;
}

export interface PreparePaymentCommand {
  attendeeId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
}

export interface PaymentManagement {
  prepare(input: PreparePaymentCommand): Promise<PaymentConfirmation>;
}
