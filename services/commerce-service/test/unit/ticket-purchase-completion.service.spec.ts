import { describe, expect, it, vi } from 'vitest';

import { TicketPurchaseCompletionService } from '../../src/ticket-purchase/services/ticket-purchase-completion.service';
import type { OrderRepository } from '../../src/orders/repositories/order.repository';
import type { PaymentAttemptRepository } from '../../src/payments/repositories/payment-attempt.repository';
import type { EventCapacityPort } from '../../src/ticket-purchase/types/event-capacity.port';
import type { PaymentProviderPort } from '../../src/payments/types/payment-provider.port';

const order = {
  orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ticketTypeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'pending_payment' as const,
};

function outcome(kind: 'payment_succeeded' | 'payment_canceled') {
  return {
    failures: 0,
    kind,
    orderId: order.orderId,
    paymentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  };
}

describe('TicketPurchaseCompletionService', () => {
  it('finalizes capacity before marking a successful order paid', async () => {
    const claimWorkflowOutcomes = vi.fn().mockResolvedValue([outcome('payment_succeeded')]);
    const completeWorkflowOutcome = vi.fn().mockResolvedValue(undefined);
    const retryWorkflowOutcome = vi.fn();
    const findById = vi.fn().mockResolvedValue(order);
    const finalize = vi.fn().mockResolvedValue({ ...order, quantity: 2, reservationId: order.orderId, status: 'finalized' });
    const markPaid = vi.fn().mockResolvedValue({ ...order, status: 'paid' });
    const service = new TicketPurchaseCompletionService(
      { claimWorkflowOutcomes, completeWorkflowOutcome, retryWorkflowOutcome } as unknown as PaymentAttemptRepository,
      { findById, markPaid } as unknown as OrderRepository,
      { finalize } as unknown as EventCapacityPort,
      {} as never,
    );

    await expect(service.process()).resolves.toBe(1);
    expect(finalize).toHaveBeenCalledOnce();
    expect(markPaid).toHaveBeenCalledOnce();
    expect(completeWorkflowOutcome).toHaveBeenCalledOnce();
    expect(retryWorkflowOutcome).not.toHaveBeenCalled();
  });

  it('retries without marking the order when Event capacity fails', async () => {
    const claimWorkflowOutcomes = vi.fn().mockResolvedValue([outcome('payment_canceled')]);
    const retryWorkflowOutcome = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockRejectedValue(new Error('EVENT_CAPACITY_UNAVAILABLE'));
    const markFailed = vi.fn();
    const service = new TicketPurchaseCompletionService(
      { claimWorkflowOutcomes, completeWorkflowOutcome: vi.fn(), retryWorkflowOutcome } as unknown as PaymentAttemptRepository,
      { findById: vi.fn().mockResolvedValue(order), markFailed } as unknown as OrderRepository,
      { release } as unknown as EventCapacityPort,
      {} as never,
    );

    await expect(service.process()).resolves.toBe(1);
    expect(markFailed).not.toHaveBeenCalled();
    expect(retryWorkflowOutcome).toHaveBeenCalledWith(expect.objectContaining({ paymentId: outcome('payment_canceled').paymentId }));
  });

  it('refunds a successful payment when capacity has expired', async () => {
    const payment = {
      paymentId: outcome('payment_succeeded').paymentId,
      orderId: order.orderId,
      amountMinor: 5000,
      currency: 'NGN',
      status: 'succeeded' as const,
      providerPaymentIntentId: 'pi_success',
    };
    const refund = {
      refundId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      paymentId: payment.paymentId,
      orderId: order.orderId,
      amountMinor: 5000,
      currency: 'NGN',
      status: 'pending' as const,
      providerIdempotencyKey: `stripe-refund:${payment.paymentId}`,
      providerRefundId: null,
    };
    const markRefunding = vi.fn().mockResolvedValue({ ...order, status: 'refunding' });
    const markRefunded = vi.fn().mockResolvedValue({ ...order, status: 'refunded' });
    const service = new TicketPurchaseCompletionService(
      {
        claimWorkflowOutcomes: vi.fn().mockResolvedValue([outcome('payment_succeeded')]),
        completeWorkflowOutcome: vi.fn().mockResolvedValue(undefined),
        retryWorkflowOutcome: vi.fn(),
        findByOrderId: vi.fn().mockResolvedValue(payment),
        findRefundByPaymentId: vi.fn().mockResolvedValue(undefined),
        createRefund: vi.fn().mockResolvedValue(refund),
        markRefundSubmitted: vi.fn().mockResolvedValue({ ...refund, providerRefundId: 're_123' }),
        markRefundSucceeded: vi.fn().mockResolvedValue({ ...refund, status: 'succeeded', providerRefundId: 're_123' }),
        markRefundFailed: vi.fn(),
      } as unknown as PaymentAttemptRepository,
      { findById: vi.fn().mockResolvedValue(order), markRefunding, markRefunded } as unknown as OrderRepository,
      { finalize: vi.fn().mockResolvedValue({ ...order, quantity: 2, reservationId: order.orderId, status: 'expired' }) } as unknown as EventCapacityPort,
      { createRefund: vi.fn().mockResolvedValue({ refundId: 're_123', paymentIntentId: 'pi_success', amountMinor: 5000, currency: 'NGN', status: 'succeeded' }) } as unknown as PaymentProviderPort,
    );

    await expect(service.process()).resolves.toBe(1);
    expect(markRefunding).toHaveBeenCalledWith(order.orderId);
    expect(markRefunded).toHaveBeenCalledWith(order.orderId);
  });

  it('retries a failed refund with the same provider idempotency key', async () => {
    const payment = { paymentId: outcome('payment_succeeded').paymentId, orderId: order.orderId, amountMinor: 5000, currency: 'NGN', status: 'succeeded' as const, providerPaymentIntentId: 'pi_success' };
    const refund = { refundId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', paymentId: payment.paymentId, orderId: order.orderId, amountMinor: 5000, currency: 'NGN', status: 'pending' as const, providerIdempotencyKey: `stripe-refund:${payment.paymentId}`, providerRefundId: null };
    const claimWorkflowOutcomes = vi.fn().mockResolvedValue([outcome('payment_succeeded')]);
    const createRefund = vi.fn()
      .mockRejectedValueOnce(new Error('PAYMENT_PROVIDER_UNAVAILABLE'))
      .mockResolvedValueOnce({ refundId: 're_123', paymentIntentId: 'pi_success', amountMinor: 5000, currency: 'NGN', status: 'succeeded' });
    const retryWorkflowOutcome = vi.fn().mockResolvedValue(undefined);
    const service = new TicketPurchaseCompletionService(
      {
        claimWorkflowOutcomes,
        completeWorkflowOutcome: vi.fn().mockResolvedValue(undefined),
        retryWorkflowOutcome,
        findByOrderId: vi.fn().mockResolvedValue(payment),
        findRefundByPaymentId: vi.fn().mockResolvedValue(refund),
        markRefundFailed: vi.fn().mockResolvedValue({ ...refund, status: 'failed' }),
        markRefundSubmitted: vi.fn().mockResolvedValue({ ...refund, providerRefundId: 're_123' }),
        markRefundSucceeded: vi.fn().mockResolvedValue({ ...refund, status: 'succeeded', providerRefundId: 're_123' }),
      } as unknown as PaymentAttemptRepository,
      { findById: vi.fn().mockResolvedValue({ ...order, status: 'refunding' }), markRefunded: vi.fn().mockResolvedValue({ ...order, status: 'refunded' }) } as unknown as OrderRepository,
      {} as unknown as EventCapacityPort,
      { createRefund } as unknown as PaymentProviderPort,
    );

    await service.process();
    await service.process();
    expect(createRefund).toHaveBeenNthCalledWith(1, { paymentIntentId: 'pi_success', idempotencyKey: refund.providerIdempotencyKey });
    expect(createRefund).toHaveBeenNthCalledWith(2, { paymentIntentId: 'pi_success', idempotencyKey: refund.providerIdempotencyKey });
    expect(retryWorkflowOutcome).toHaveBeenCalledOnce();
  });

  it('completes a duplicate delivery after refund is already terminal', async () => {
    const completeWorkflowOutcome = vi.fn().mockResolvedValue(undefined);
    const service = new TicketPurchaseCompletionService(
      { claimWorkflowOutcomes: vi.fn().mockResolvedValue([outcome('payment_succeeded')]), completeWorkflowOutcome, retryWorkflowOutcome: vi.fn() } as unknown as PaymentAttemptRepository,
      { findById: vi.fn().mockResolvedValue({ ...order, status: 'refunded' }) } as unknown as OrderRepository,
      {} as unknown as EventCapacityPort,
      {} as unknown as PaymentProviderPort,
    );

    await expect(service.process()).resolves.toBe(1);
    expect(completeWorkflowOutcome).toHaveBeenCalledOnce();
  });
});
