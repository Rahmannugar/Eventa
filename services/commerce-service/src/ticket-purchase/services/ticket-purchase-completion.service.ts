import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { recordBusinessOutcome } from '@eventa/observability';
import { randomUUID } from 'node:crypto';

import type { CancelledEventRefundClaim } from '../../cancelled-event-refunds/types/cancelled-event-refund.types';
import type { OrderRepository } from '../../orders/repositories/order.repository';
import type { PaymentAttemptRepository } from '../../payments/repositories/payment-attempt.repository';
import type {
  PaymentWorkflowOutcomeKind,
  PaymentWorkflowOutcomeRecord,
} from '../../payments/types/payment-attempt.types';
import {
  PaymentRefundExecutor,
  PaymentRefundTerminalError,
} from '../../payments/services/payment-refund.executor';
import type { PaymentProviderPort } from '../../payments/types/payment-provider.port';
import type {
  EventCapacityPort,
  EventCapacityTransitionResult,
} from '../types/event-capacity.port';

const BATCH_SIZE = 25;
const LEASE_MS = 120_000;
const SWEEP_MS = 5_000;
const RETRY_MS = 30_000;
const ATTENTION_FAILURE_COUNT = 5;
const COMPLETION_OUTCOME_KINDS: readonly PaymentWorkflowOutcomeKind[] = [
  'payment_canceled',
  'payment_succeeded',
];

export class TicketPurchaseCompletionService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TicketPurchaseCompletionService.name);
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  private readonly refunds: PaymentRefundExecutor;

  constructor(
    private readonly outcomes: PaymentAttemptRepository,
    private readonly orders: OrderRepository,
    private readonly capacity: EventCapacityPort,
    provider: PaymentProviderPort,
    private readonly cancelledEventRefunds: CancelledEventRefundClaim,
  ) {
    this.refunds = new PaymentRefundExecutor(outcomes, provider);
  }

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
        kinds: COMPLETION_OUTCOME_KINDS,
        limit: BATCH_SIZE,
        now,
      });
      for (const outcome of claimed) await this.processOutcome(outcome);
      return claimed.length;
    } catch (error: unknown) {
      recordBusinessOutcome({
        operation: 'commerce.ticket_purchase_completion',
        outcome: 'sweep_failed',
      });
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'ticket_purchase_completion_sweep_failed',
        operation: 'commerce.ticket_purchase.complete_due',
      });
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async processOutcome(
    outcome: PaymentWorkflowOutcomeRecord,
  ): Promise<void> {
    try {
      const order = await this.orders.findById(outcome.orderId);
      if (order === undefined) throw new Error('ORDER_NOT_FOUND');
      if (outcome.kind === 'payment_succeeded' && order.status === 'refunded') {
        await this.outcomes.completeWorkflowOutcome(outcome);
        this.recordOutcome('already_refunded');
        return;
      }
      if (
        outcome.kind === 'payment_canceled' &&
        order.status !== 'pending_payment'
      ) {
        await this.outcomes.completeWorkflowOutcome(outcome);
        this.recordOutcome('already_terminal');
        return;
      }
      if (
        outcome.kind === 'payment_succeeded' &&
        order.status === 'refunding'
      ) {
        await this.refundLateSuccess(outcome);
        await this.outcomes.completeWorkflowOutcome(outcome);
        this.recordOutcome('refunded');
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
        result = await this.capacity.finalize(command);
      } else {
        result = await this.capacity.release(command);
      }
      if (outcome.kind === 'payment_succeeded') {
        if (result.status === 'expired') {
          await this.orders.markRefunding(order.orderId);
          await this.refundLateSuccess(outcome);
          await this.outcomes.completeWorkflowOutcome(outcome);
          this.recordOutcome('refunded');
          return;
        }
        await this.orders.markPaid(order.orderId);
        await this.cancelledEventRefunds.ensureOrderClaimed({
          eventId: order.eventId,
          orderId: order.orderId,
        });
      } else {
        await this.orders.markFailed({
          failureCode: 'PAYMENT_CANCELED',
          orderId: order.orderId,
        });
      }
      await this.outcomes.completeWorkflowOutcome(outcome);
      this.recordOutcome(
        outcome.kind === 'payment_succeeded' ? 'paid' : 'failed',
      );
    } catch (error: unknown) {
      if (error instanceof PaymentRefundTerminalError) {
        await this.outcomes.completeWorkflowOutcome(outcome);
        this.recordOutcome('refund_failed');
        this.logger.error({
          error_type: error.name,
          event: 'ticket_purchase_refund_failed',
          operation: 'commerce.ticket_purchase.refund',
          order_id: outcome.orderId,
          payment_id: outcome.paymentId,
        });
        return;
      }
      await this.outcomes.retryWorkflowOutcome({
        availableAt: new Date(Date.now() + RETRY_MS),
        kind: outcome.kind,
        paymentId: outcome.paymentId,
      });
      const attentionRequired = outcome.failures + 1 >= ATTENTION_FAILURE_COUNT;
      this.recordOutcome(
        attentionRequired ? 'attention_required' : 'retry_scheduled',
      );
      const details = {
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: attentionRequired
          ? 'ticket_purchase_completion_attention_required'
          : 'ticket_purchase_completion_retry_scheduled',
        operation: 'commerce.ticket_purchase.complete',
        order_id: outcome.orderId,
        payment_id: outcome.paymentId,
      };
      if (attentionRequired) this.logger.error(details);
      else this.logger.warn(details);
    }
  }

  private recordOutcome(outcome: string): void {
    recordBusinessOutcome({
      operation: 'commerce.ticket_purchase_completion',
      outcome,
    });
  }

  private async refundLateSuccess(
    outcome: PaymentWorkflowOutcomeRecord,
  ): Promise<void> {
    await this.refunds.execute(outcome.orderId);
    await this.orders.markRefunded(outcome.orderId);
  }
}
