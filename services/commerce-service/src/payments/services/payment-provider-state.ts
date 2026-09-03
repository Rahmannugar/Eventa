import {
  PAYMENT_RECONCILIATION_INTERVAL_MS,
  PAYMENT_RECONCILIATION_WAITING_INTERVAL_MS,
} from '../payment-reconciliation.constants';
import type { PaymentAttemptStatus } from '../types/payment-attempt.types';
import type { ProviderPaymentIntent } from '../types/payment-provider.port';

export function resolvePaymentAttemptStatus(
  intent: ProviderPaymentIntent,
): Exclude<PaymentAttemptStatus, 'provider_pending'> {
  if (intent.status === 'succeeded') return 'succeeded';
  if (intent.status === 'canceled') return 'canceled';
  if (intent.status === 'processing' || intent.status === 'requires_capture') {
    return 'processing';
  }
  if (intent.status === 'requires_action') return 'requires_action';
  if (
    intent.status === 'requires_payment_method' &&
    intent.hasLastPaymentError
  ) {
    return 'failed';
  }
  if (
    intent.status === 'requires_payment_method' ||
    intent.status === 'requires_confirmation'
  ) {
    return 'awaiting_confirmation';
  }
  throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');
}

export function nextPaymentReconciliationAt(
  status: Exclude<PaymentAttemptStatus, 'provider_pending'>,
  now: Date,
): Date | null {
  if (status === 'succeeded' || status === 'canceled') return null;
  const delay =
    status === 'processing'
      ? PAYMENT_RECONCILIATION_INTERVAL_MS
      : PAYMENT_RECONCILIATION_WAITING_INTERVAL_MS;
  return new Date(now.getTime() + delay);
}
