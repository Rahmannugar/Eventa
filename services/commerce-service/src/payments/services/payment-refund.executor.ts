import { randomUUID } from 'node:crypto';

import type { PaymentAttemptRepository } from '../repositories/payment-attempt.repository';
import type {
  PaymentProviderPort,
  ProviderRefund,
} from '../types/payment-provider.port';

export class PaymentRefundTerminalError extends Error {
  constructor() {
    super('PAYMENT_REFUND_FAILED');
  }
}

export class PaymentRefundExecutor {
  constructor(
    private readonly payments: PaymentAttemptRepository,
    private readonly provider: PaymentProviderPort,
  ) {}

  async execute(orderId: string): Promise<void> {
    const payment = await this.payments.findByOrderId(orderId);
    if (
      payment === undefined ||
      payment.status !== 'succeeded' ||
      payment.providerPaymentIntentId === null
    ) {
      throw new Error('PAYMENT_NOT_REFUNDABLE');
    }
    let refund = await this.payments.findRefundByPaymentId(payment.paymentId);
    refund ??= await this.payments.createRefund({
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      orderId: payment.orderId,
      paymentId: payment.paymentId,
      providerIdempotencyKey: `stripe-refund:${payment.paymentId}`,
      refundId: randomUUID(),
    });
    if (refund.status === 'succeeded') return;

    try {
      let providerRefund: ProviderRefund;
      if (refund.providerRefundId !== null) {
        if (this.provider.retrieveRefund === undefined) {
          throw new Error('PAYMENT_REFUND_RETRIEVAL_UNAVAILABLE');
        }
        providerRefund = await this.provider.retrieveRefund(
          refund.providerRefundId,
        );
      } else {
        if (this.provider.createRefund === undefined) {
          throw new Error('PAYMENT_REFUND_UNAVAILABLE');
        }
        providerRefund = await this.provider.createRefund({
          idempotencyKey: refund.providerIdempotencyKey,
          paymentIntentId: payment.providerPaymentIntentId,
        });
        refund = await this.payments.markRefundSubmitted(
          refund.refundId,
          providerRefund.refundId,
        );
      }
      this.assertRefundMatchesPayment(providerRefund, payment);
      if (
        providerRefund.status === 'failed' ||
        providerRefund.status === 'canceled'
      ) {
        await this.payments.markRefundFailed(refund.refundId);
        throw new PaymentRefundTerminalError();
      }
      if (providerRefund.status !== 'succeeded') {
        throw new Error('PAYMENT_REFUND_NOT_SUCCEEDED');
      }
      await this.payments.markRefundSucceeded(
        refund.refundId,
        providerRefund.refundId,
      );
    } catch (error: unknown) {
      if (refund.providerRefundId === null) {
        await this.payments.markRefundFailed(refund.refundId);
      }
      throw error;
    }
  }

  private assertRefundMatchesPayment(
    refund: ProviderRefund,
    payment: {
      amountMinor: number;
      currency: string;
      providerPaymentIntentId: string | null;
    },
  ): void {
    if (
      refund.paymentIntentId !== payment.providerPaymentIntentId ||
      refund.amountMinor !== payment.amountMinor ||
      refund.currency !== payment.currency
    ) {
      throw new Error('PAYMENT_REFUND_RESPONSE_INVALID');
    }
  }
}
