import { describe, expect, it, vi } from 'vitest';

import { PaymentProviderEventService } from '../../src/payments/services/payment-provider-event.service';
import type { PaymentProviderEventRepository } from '../../src/payments/types/payment-attempt.types';
import type {
  PaymentProviderPort,
  PaymentWebhookVerifier,
  ProviderPaymentIntent,
} from '../../src/payments/types/payment-provider.port';

const providerEvent = {
  eventId: 'evt_eventa_payment',
  eventType: 'payment_intent.succeeded',
  paymentIntentId: 'pi_eventa_payment',
  providerCreatedAt: new Date('2026-08-31T12:00:00.000Z'),
};

const intent: ProviderPaymentIntent = {
  amountMinor: 5_000,
  clientSecret: null,
  currency: 'NGN',
  hasLastPaymentError: false,
  metadata: {
    eventa_order_id: 'f0caa9fc-6f69-4118-ad7f-110d872da987',
    eventa_payment_id: '25cb26ef-73fa-4e59-85fc-11d67d0205f3',
  },
  paymentIntentId: providerEvent.paymentIntentId,
  status: 'succeeded',
};

function context(
  receipt: 'received' | 'duplicate' = 'received',
  providerIntent: ProviderPaymentIntent = intent,
) {
  const attempts = {
    applyProviderEvent: vi
      .fn<PaymentProviderEventRepository['applyProviderEvent']>()
      .mockResolvedValue('processed'),
    registerProviderEvent: vi
      .fn<PaymentProviderEventRepository['registerProviderEvent']>()
      .mockResolvedValue(receipt),
  };
  const provider = {
    createIntent: vi.fn<PaymentProviderPort['createIntent']>(),
    retrieveIntent: vi
      .fn<PaymentProviderPort['retrieveIntent']>()
      .mockResolvedValue(providerIntent),
  };
  const verifier = {
    verifyWebhook: vi
      .fn<PaymentWebhookVerifier['verifyWebhook']>()
      .mockReturnValue(providerEvent),
  };
  return {
    attempts,
    events: new PaymentProviderEventService(attempts, provider, verifier),
    provider,
    verifier,
  };
}

describe('PaymentProviderEventService', () => {
  it('applies current provider state', async () => {
    const payment = context();

    await expect(
      payment.events.handle(Buffer.from('{}'), 't=1,v1=signature'),
    ).resolves.toBe('processed');

    expect(payment.provider.retrieveIntent).toHaveBeenCalledWith(
      providerEvent.paymentIntentId,
    );
    expect(payment.attempts.applyProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: providerEvent.eventType,
        intent,
        reconcileAfter: null,
        status: 'succeeded',
      }),
    );
  });

  it('does not retrieve a completed duplicate', async () => {
    const payment = context('duplicate');

    await expect(
      payment.events.handle(Buffer.from('{}'), 't=1,v1=signature'),
    ).resolves.toBe('duplicate');

    expect(payment.provider.retrieveIntent).not.toHaveBeenCalled();
    expect(payment.attempts.applyProviderEvent).not.toHaveBeenCalled();
  });

  it('records a failed confirmation separately from cancellation', async () => {
    const payment = context('received', {
      ...intent,
      hasLastPaymentError: true,
      status: 'requires_payment_method',
    });

    await payment.events.handle(Buffer.from('{}'), 't=1,v1=signature');

    const application = payment.attempts.applyProviderEvent.mock.calls[0]?.[0];
    expect(application?.status).toBe('failed');
    expect(application?.reconcileAfter).toBeInstanceOf(Date);
  });

  it('rejects an empty body before verification', async () => {
    const payment = context();

    await expect(
      payment.events.handle(Buffer.alloc(0), 't=1,v1=signature'),
    ).rejects.toThrow('PAYMENT_WEBHOOK_SIGNATURE_INVALID');
    expect(payment.verifier.verifyWebhook).not.toHaveBeenCalled();
  });
});
