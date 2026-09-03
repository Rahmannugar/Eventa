import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { OrderRepository } from '../../orders/repositories/order.repository';
import type { PaymentAttemptRepository } from '../../payments/repositories/payment-attempt.repository';
import type { PaymentWorkflowOutcomeRecord } from '../../payments/types/payment-attempt.types';
import type { PaymentProviderPort, ProviderRefund } from '../../payments/types/payment-provider.port';
import type {
  EventCapacityPort,
  EventCapacityTransitionResult,
} from '../types/event-capacity.port';

const BATCH_SIZE = 25;
const LEASE_MS = 120_000;
const SWEEP_MS = 5_000;
const RETRY_MS = 30_000;

export class TicketPurchaseCompletionService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TicketPurchaseCompletionService.name);
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly outcomes: PaymentAttemptRepository,
    private readonly orders: OrderRepository,
    private readonly capacity: EventCapacityPort,
    private readonly provider: PaymentProviderPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.process(), SWEEP_MS);
    this.timer.unref();
    void this.process();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async process(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = new Date();
      const claimed = await this.outcomes.claimWorkflowOutcomes({
        claimedUntil: new Date(now.getTime() + LEASE_MS),
        limit: BATCH_SIZE,
        now,
      });
      for (const outcome of claimed) await this.processOutcome(outcome);
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private async processOutcome(outcome: PaymentWorkflowOutcomeRecord): Promise<void> {
    try {
      const order = await this.orders.findById(outcome.orderId);
      if (order === undefined) throw new Error('ORDER_NOT_FOUND');
      if (outcome.kind === 'payment_succeeded' && order.status === 'refunded') {
        await this.outcomes.completeWorkflowOutcome(outcome);
        return;
      }
      if (outcome.kind === 'payment_canceled' && order.status !== 'pending_payment') {
        await this.outcomes.completeWorkflowOutcome(outcome);
        return;
      }
      if (outcome.kind === 'payment_succeeded' && order.status === 'refunding') {
        await this.refundLateSuccess(outcome);
        await this.outcomes.completeWorkflowOutcome(outcome);
        return;
      }
      let result: EventCapacityTransitionResult;
      const command = {
        eventId: order.eventId,
        requestId: `purchase-completion:${randomUUID()}`,
        reservationId: order.orderId,
        ticketTypeId: order.ticketTypeId,
      };
      if (outcome.kind === 'payment_succeeded') {
        if (this.capacity.finalize === undefined) {
          throw new Error('EVENT_CAPACITY_TRANSITION_UNAVAILABLE');
        }
        result = await this.capacity.finalize(command);
      } else {
        if (this.capacity.release === undefined) {
          throw new Error('EVENT_CAPACITY_TRANSITION_UNAVAILABLE');
        }
        result = await this.capacity.release(command);
      }
      if (outcome.kind === 'payment_succeeded') {
        if (result.status === 'expired') {
          await this.orders.markRefunding(order.orderId);
          await this.refundLateSuccess(outcome);
          await this.outcomes.completeWorkflowOutcome(outcome);
          return;
        }
        await this.orders.markPaid(order.orderId);
      } else {
        await this.orders.markFailed({
          failureCode: 'PAYMENT_CANCELED',
          orderId: order.orderId,
        });
      }
      await this.outcomes.completeWorkflowOutcome(outcome);
    } catch (error: unknown) {
      await this.outcomes.retryWorkflowOutcome({
        availableAt: new Date(Date.now() + RETRY_MS),
        kind: outcome.kind,
        paymentId: outcome.paymentId,
      });
      this.logger.warn({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'ticket_purchase_completion_retry_scheduled',
        operation: 'commerce.ticket_purchase.complete',
        order_id: outcome.orderId,
        payment_id: outcome.paymentId,
      });
    }
  }

  private async refundLateSuccess(outcome: PaymentWorkflowOutcomeRecord): Promise<void> {
    const payment = await this.outcomes.findByOrderId(outcome.orderId);
    if (payment === undefined || payment.status !== 'succeeded' || payment.providerPaymentIntentId === null) {
      throw new Error('PAYMENT_NOT_REFUNDABLE');
    }
    let refund = await this.outcomes.findRefundByPaymentId(payment.paymentId);
    refund ??= await this.outcomes.createRefund({
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      orderId: payment.orderId,
      paymentId: payment.paymentId,
      providerIdempotencyKey: `stripe-refund:${payment.paymentId}`,
      refundId: randomUUID(),
    });
    if (refund.status === 'succeeded') {
      await this.orders.markRefunded(outcome.orderId);
      return;
    }
    let providerRefund: ProviderRefund;
    try {
      if (refund.providerRefundId !== null) {
        if (this.provider.retrieveRefund === undefined) throw new Error('PAYMENT_REFUND_RETRIEVAL_UNAVAILABLE');
        providerRefund = await this.provider.retrieveRefund(refund.providerRefundId);
      } else {
        if (this.provider.createRefund === undefined) throw new Error('PAYMENT_REFUND_UNAVAILABLE');
        providerRefund = await this.provider.createRefund({
          idempotencyKey: refund.providerIdempotencyKey,
          paymentIntentId: payment.providerPaymentIntentId,
        });
        refund = await this.outcomes.markRefundSubmitted(refund.refundId, providerRefund.refundId);
      }
      this.assertRefundMatchesPayment(providerRefund, payment);
      if (providerRefund.status !== 'succeeded') throw new Error('PAYMENT_REFUND_NOT_SUCCEEDED');
      await this.outcomes.markRefundSucceeded(refund.refundId, providerRefund.refundId);
      await this.orders.markRefunded(outcome.orderId);
    } catch (error: unknown) {
      if (refund.providerRefundId === null) await this.outcomes.markRefundFailed(refund.refundId);
      throw error;
    }
  }

  private assertRefundMatchesPayment(
    refund: ProviderRefund,
    payment: { amountMinor: number; currency: string; providerPaymentIntentId: string | null },
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
