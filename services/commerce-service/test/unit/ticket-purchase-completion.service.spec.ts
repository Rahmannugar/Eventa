import { describe, expect, it, vi } from 'vitest';

import { TicketPurchaseCompletionService } from '../../src/ticket-purchase/services/ticket-purchase-completion.service';
import type { OrderRepository } from '../../src/orders/repositories/order.repository';
import type { PaymentAttemptRepository } from '../../src/payments/repositories/payment-attempt.repository';
import type { EventCapacityPort } from '../../src/ticket-purchase/types/event-capacity.port';

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
    );

    await expect(service.process()).resolves.toBe(1);
    expect(markFailed).not.toHaveBeenCalled();
    expect(retryWorkflowOutcome).toHaveBeenCalledWith(expect.objectContaining({ paymentId: outcome('payment_canceled').paymentId }));
  });
});
