import { describe, expect, it, vi } from 'vitest';

import { PaymentReconciliationService } from '../../src/payments/services/payment-reconciliation.service';
import type {
  PaymentAttemptRecord,
  PaymentReconciliationRepository,
} from '../../src/payments/types/payment-attempt.types';
import type { PaymentProviderPort } from '../../src/payments/types/payment-provider.port';

const attempt: PaymentAttemptRecord = {
  amountMinor: 5_000,
  attendeeId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
  createdAt: new Date('2026-08-31T10:00:00.000Z'),
  currency: 'NGN',
  lastProviderEventCreatedAt: null,
  lastProviderEventId: null,
  lastReconciledAt: null,
  orderId: 'f0caa9fc-6f69-4118-ad7f-110d872da987',
  paymentId: '25cb26ef-73fa-4e59-85fc-11d67d0205f3',
  provider: 'stripe',
  providerIdempotencyKey: 'eventa-payment:25cb26ef-73fa-4e59-85fc-11d67d0205f3',
  providerPaymentIntentId: 'pi_eventa_reconciliation',
  providerStatus: 'processing',
  reconcileAfter: new Date('2026-08-31T10:00:00.000Z'),
  reconciliationClaimedUntil: null,
  reconciliationFailures: 0,
  status: 'processing',
  updatedAt: new Date('2026-08-31T10:00:00.000Z'),
};

describe('PaymentReconciliationService', () => {
  it('schedules a retry after provider failure', async () => {
    const attempts = {
      applyReconciliation:
        vi.fn<PaymentReconciliationRepository['applyReconciliation']>(),
      claimReconciliationBatch: vi
        .fn<PaymentReconciliationRepository['claimReconciliationBatch']>()
        .mockResolvedValue([attempt]),
      recordReconciliationFailure: vi
        .fn<PaymentReconciliationRepository['recordReconciliationFailure']>()
        .mockResolvedValue(undefined),
    };
    const provider = {
      createIntent: vi.fn<PaymentProviderPort['createIntent']>(),
      retrieveIntent: vi
        .fn<PaymentProviderPort['retrieveIntent']>()
        .mockRejectedValue(new Error('PAYMENT_PROVIDER_UNAVAILABLE')),
    };
    const reconciliation = new PaymentReconciliationService(attempts, provider);

    await expect(reconciliation.reconcile()).resolves.toBe(1);

    const retry = attempts.recordReconciliationFailure.mock.calls[0]?.[0];
    expect(retry?.paymentId).toBe(attempt.paymentId);
    expect(retry?.now).toBeInstanceOf(Date);
    expect(retry?.reconcileAfter).toBeInstanceOf(Date);
    expect(attempts.applyReconciliation).not.toHaveBeenCalled();
  });
});
