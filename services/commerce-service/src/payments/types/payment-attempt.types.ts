import type { ProviderPaymentIntent } from './payment-provider.port';

export type PaymentAttemptStatus =
  | 'provider_pending'
  | 'awaiting_confirmation'
  | 'requires_action'
  | 'processing'
  | 'failed'
  | 'succeeded'
  | 'canceled';

export type PaymentWorkflowOutcomeKind = 'payment_succeeded' | 'payment_canceled';

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
  claimWorkflowOutcomes(input: {
    now: Date;
    claimedUntil: Date;
    limit: number;
  }): Promise<PaymentWorkflowOutcomeRecord[]>;
  completeWorkflowOutcome(input: {
    paymentId: string;
    kind: PaymentWorkflowOutcomeKind;
  }): Promise<void>;
  retryWorkflowOutcome(input: {
    paymentId: string;
    kind: PaymentWorkflowOutcomeKind;
    availableAt: Date;
  }): Promise<void>;
  findByOrderId(orderId: string): Promise<PaymentAttemptRecord | undefined>;
  createRefund(input: {
    refundId: string;
    paymentId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    providerIdempotencyKey: string;
  }): Promise<PaymentRefundRecord>;
  findRefundByPaymentId(paymentId: string): Promise<PaymentRefundRecord | undefined>;
  markRefundFailed(refundId: string): Promise<PaymentRefundRecord>;
  markRefundSubmitted(refundId: string, providerRefundId: string): Promise<PaymentRefundRecord>;
  markRefundSucceeded(refundId: string, providerRefundId: string): Promise<PaymentRefundRecord>;
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

export type PaymentWorkflowRepository = Pick<
  PaymentAttemptRepository,
  'claimWorkflowOutcomes' | 'completeWorkflowOutcome' | 'retryWorkflowOutcome'
>;

export interface PaymentWorkflowOutcomeRecord {
  paymentId: string;
  orderId: string;
  kind: PaymentWorkflowOutcomeKind;
  failures: number;
}

export interface PaymentRefundRecord {
  refundId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  providerIdempotencyKey: string;
  providerRefundId: string | null;
}


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
