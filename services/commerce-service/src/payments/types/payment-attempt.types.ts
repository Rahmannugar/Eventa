import type { ProviderPaymentIntent } from './payment-provider.port';

export type PaymentAttemptStatus =
  | 'provider_pending'
  | 'awaiting_confirmation'
  | 'requires_action'
  | 'processing'
  | 'failed'
  | 'succeeded'
  | 'canceled';

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
  lastProviderEventId: string | null;
  lastProviderEventCreatedAt: Date | null;
  reconcileAfter: Date | null;
  reconciliationClaimedUntil: Date | null;
  reconciliationFailures: number;
  lastReconciledAt: Date | null;
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
  reconcileAfter: Date;
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
  registerProviderEvent(
    input: ProviderEventRegistration,
  ): Promise<'received' | 'duplicate'>;
  applyProviderEvent(
    input: ProviderEventApplication,
  ): Promise<'processed' | 'ignored' | 'duplicate'>;
  claimReconciliationBatch(input: {
    now: Date;
    claimedUntil: Date;
    limit: number;
  }): Promise<PaymentAttemptRecord[]>;
  applyReconciliation(input: {
    paymentId: string;
    intent: ProviderPaymentIntent;
    now: Date;
    reconcileAfter: Date | null;
    status: Exclude<PaymentAttemptStatus, 'provider_pending'>;
  }): Promise<PaymentAttemptRecord>;
  recordReconciliationFailure(input: {
    paymentId: string;
    now: Date;
    reconcileAfter: Date;
  }): Promise<void>;
}

export type PaymentPreparationRepository = Pick<
  PaymentAttemptRepository,
  'createPending' | 'markAwaitingConfirmation'
>;

export type PaymentProviderEventRepository = Pick<
  PaymentAttemptRepository,
  'registerProviderEvent' | 'applyProviderEvent'
>;

export type PaymentReconciliationRepository = Pick<
  PaymentAttemptRepository,
  | 'claimReconciliationBatch'
  | 'applyReconciliation'
  | 'recordReconciliationFailure'
>;


export interface ProviderEventRegistration {
  providerEventId: string;
  eventType: string;
  providerObjectId: string;
  providerCreatedAt: Date;
}

export interface ProviderEventApplication extends ProviderEventRegistration {
  intent: ProviderPaymentIntent;
  status: Exclude<PaymentAttemptStatus, 'provider_pending'>;
  reconcileAfter: Date | null;
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

export interface PaymentProviderEventHandling {
  handle(
    rawBody: Buffer,
    signature: string,
  ): Promise<'processed' | 'ignored' | 'duplicate'>;
}

export interface PaymentReconciliation {
  reconcile(): Promise<number>;
}
