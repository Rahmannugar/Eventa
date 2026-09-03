import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { StripePaymentProviderAdapter } from '../../src/payments/adapters/stripe-payment-provider.adapter';

const webhookSecret = 'whsec_eventa_unit_test';
const stripe = new Stripe('sk_test_eventa_unit_test');
const adapter = new StripePaymentProviderAdapter({
  maxNetworkRetries: 0,
  secretKey: 'sk_test_eventa_unit_test',
  timeoutMs: 100,
  webhookSecret,
});

function signedEvent(type = 'payment_intent.succeeded') {
  const payload = JSON.stringify({
    created: 1_788_184_800,
    data: {
      object: {
        id: 'pi_eventa_webhook',
        object: 'payment_intent',
      },
    },
    id: 'evt_eventa_webhook',
    object: 'event',
    type,
  });
  return {
    payload,
    signature: stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1_000),
    }),
  };
}

describe('StripePaymentProviderAdapter webhook verification', () => {
  it('accepts a signed payment event', () => {
    const event = signedEvent();

    expect(
      adapter.verifyWebhook(Buffer.from(event.payload), event.signature),
    ).toEqual({
      eventId: 'evt_eventa_webhook',
      eventType: 'payment_intent.succeeded',
      paymentIntentId: 'pi_eventa_webhook',
      providerCreatedAt: new Date('2026-08-31T14:00:00.000Z'),
    });
  });

  it('rejects a changed payload', () => {
    const event = signedEvent();

    expect(() =>
      adapter.verifyWebhook(Buffer.from(`${event.payload} `), event.signature),
    ).toThrow('PAYMENT_WEBHOOK_SIGNATURE_INVALID');
  });

  it('ignores an unsubscribed event type', () => {
    const event = signedEvent('charge.updated');

    expect(
      adapter.verifyWebhook(Buffer.from(event.payload), event.signature),
    ).toBeNull();
  });
});
