import { describe, expect, it, vi } from 'vitest';

import { PaymentAttemptService } from '../../src/payments/services/payment-attempt.service';
import type {
  PaymentAttemptRecord,
  PaymentAttemptRepository,
} from '../../src/payments/types/payment-attempt.types';
import type {
  PaymentProviderPort,
  ProviderPaymentIntent,
} from '../../src/payments/types/payment-provider.port';

const input = {
  amountMinor: 5_000,
  attendeeId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
  currency: 'NGN',
  orderId: 'f0caa9fc-6f69-4118-ad7f-110d872da987',
};

function attempt(
  overrides: Partial<PaymentAttemptRecord> = {},
): PaymentAttemptRecord {
  return {
    ...input,
    createdAt: new Date('2026-08-31T10:00:00.000Z'),
    paymentId: '25cb26ef-73fa-4e59-85fc-11d67d0205f3',
    lastProviderEventCreatedAt: null,
    lastProviderEventId: null,
    lastReconciledAt: null,
    provider: 'stripe',
    providerIdempotencyKey:
      'eventa-payment:25cb26ef-73fa-4e59-85fc-11d67d0205f3',
    providerPaymentIntentId: null,
    providerStatus: null,
    reconcileAfter: null,
    reconciliationClaimedUntil: null,
    reconciliationFailures: 0,
    status: 'provider_pending',
    updatedAt: new Date('2026-08-31T10:00:00.000Z'),
    ...overrides,
  };
}

function intent(
  overrides: Partial<ProviderPaymentIntent> = {},
): ProviderPaymentIntent {
  return {
    amountMinor: input.amountMinor,
    clientSecret: 'pi_eventa_checkout_secret_confirmation',
    currency: input.currency,
    hasLastPaymentError: false,
    metadata: {
      eventa_order_id: input.orderId,
      eventa_payment_id: attempt().paymentId,
    },
    paymentIntentId: 'pi_eventa_checkout',
    status: 'requires_payment_method',
    ...overrides,
  };
}

function service(options: {
  record?: PaymentAttemptRecord;
  providerIntent?: ProviderPaymentIntent;
}) {
  const record = options.record ?? attempt();
  const repository = {
    createPending: vi
      .fn<PaymentAttemptRepository['createPending']>()
      .mockResolvedValue(record),
    markAwaitingConfirmation: vi
      .fn<PaymentAttemptRepository['markAwaitingConfirmation']>()
      .mockResolvedValue(
        attempt({
          providerPaymentIntentId: 'pi_eventa_checkout',
          providerStatus: 'requires_payment_method',
          status: 'awaiting_confirmation',
        }),
      ),
  };
  const provider = {
    createIntent: vi
      .fn<PaymentProviderPort['createIntent']>()
      .mockResolvedValue(options.providerIntent ?? intent()),
    retrieveIntent: vi
      .fn<PaymentProviderPort['retrieveIntent']>()
      .mockResolvedValue(options.providerIntent ?? intent()),
  };
  return {
    payment: new PaymentAttemptService(repository, provider),
    provider,
    repository,
  };
}

describe('PaymentAttemptService', () => {
  it('creates Stripe payment from the durable attempt identity', async () => {
    const context = service({});

    await expect(context.payment.prepare(input)).resolves.toEqual({
      clientSecret: 'pi_eventa_checkout_secret_confirmation',
      paymentId: attempt().paymentId,
    });
    expect(context.provider.createIntent).toHaveBeenCalledWith({
      amountMinor: input.amountMinor,
      currency: input.currency,
      idempotencyKey: attempt().providerIdempotencyKey,
      orderId: input.orderId,
      paymentId: attempt().paymentId,
    });
    expect(context.repository.markAwaitingConfirmation).toHaveBeenCalledWith({
      paymentId: attempt().paymentId,
      providerPaymentIntentId: 'pi_eventa_checkout',
      providerStatus: 'requires_payment_method',
    });
  });

  it('retrieves Stripe payment for a resolved retry', async () => {
    const context = service({
      record: attempt({
        providerPaymentIntentId: 'pi_eventa_checkout',
        providerStatus: 'requires_payment_method',
        status: 'awaiting_confirmation',
      }),
    });

    await context.payment.prepare(input);

    expect(context.provider.createIntent).not.toHaveBeenCalled();
    expect(context.provider.retrieveIntent).toHaveBeenCalledWith(
      'pi_eventa_checkout',
    );
  });

  it('rejects a mismatched Stripe amount', async () => {
    const context = service({
      providerIntent: intent({ amountMinor: input.amountMinor + 1 }),
    });

    await expect(context.payment.prepare(input)).rejects.toThrow(
      'PAYMENT_PROVIDER_RESPONSE_INVALID',
    );
    expect(context.repository.markAwaitingConfirmation).not.toHaveBeenCalled();
  });
});
