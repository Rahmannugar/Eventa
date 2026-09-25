import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { recordBusinessOutcome } from '@eventa/observability';

import type { OrderRepository } from '../../orders/repositories/order.repository';
import type { PaymentAttemptRepository } from '../../payments/repositories/payment-attempt.repository';
import {
  PaymentRefundExecutor,
  PaymentRefundTerminalError,
} from '../../payments/services/payment-refund.executor';
import type { PaymentProviderPort } from '../../payments/types/payment-provider.port';
import type { PaymentWorkflowOutcomeRecord } from '../../payments/types/payment-attempt.types';
import { EVENT_CANCELLED_OPERATION } from '../constants/cancelled-event-refund.constants';

const BATCH_SIZE = 25;
const LEASE_MS = 120_000;
const SWEEP_MS = 5_000;
const RETRY_MS = 30_000;
const ATTENTION_FAILURE_COUNT = 5;

@Injectable()
export class CancelledEventRefundWorker
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(CancelledEventRefundWorker.name);
  private readonly refunds: PaymentRefundExecutor;
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly payments: PaymentAttemptRepository,
    private readonly orders: OrderRepository,
    provider: PaymentProviderPort,
  ) {
    this.refunds = new PaymentRefundExecutor(payments, provider);
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
      const claimed = await this.payments.claimWorkflowOutcomes({
        claimedUntil: new Date(now.getTime() + LEASE_MS),
        kinds: ['event_cancelled'],
        limit: BATCH_SIZE,
        now,
      });
      for (const outcome of claimed) await this.processOutcome(outcome);
      return claimed.length;
    } catch (error: unknown) {
      recordBusinessOutcome({
        operation: EVENT_CANCELLED_OPERATION,
        outcome: 'sweep_failed',
      });
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'cancelled_event_refund_sweep_failed',
        operation: 'commerce.cancelled_event_refund.execute_due',
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
      if (order.status === 'refunded') {
        await this.payments.completeWorkflowOutcome(outcome);
        this.recordOutcome('already_refunded');
        return;
      }
      if (order.status !== 'refunding') {
        throw new Error('ORDER_NOT_REFUNDING');
      }
      await this.refunds.execute(outcome.orderId);
      await this.orders.markRefunded(outcome.orderId);
      await this.payments.completeWorkflowOutcome(outcome);
      this.recordOutcome('refunded');
    } catch (error: unknown) {
      if (error instanceof PaymentRefundTerminalError) {
        await this.payments.completeWorkflowOutcome(outcome);
        this.recordOutcome('refund_failed');
        this.logger.error({
          error_type: error.name,
          event: 'cancelled_event_refund_failed',
          operation: 'commerce.cancelled_event_refund.execute',
          order_id: outcome.orderId,
          payment_id: outcome.paymentId,
        });
        return;
      }
      await this.payments.retryWorkflowOutcome({
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
          ? 'cancelled_event_refund_attention_required'
          : 'cancelled_event_refund_retry_scheduled',
        operation: 'commerce.cancelled_event_refund.execute',
        order_id: outcome.orderId,
        payment_id: outcome.paymentId,
      };
      if (attentionRequired) this.logger.error(details);
      else this.logger.warn(details);
    }
  }

  private recordOutcome(outcome: string): void {
    recordBusinessOutcome({
      operation: EVENT_CANCELLED_OPERATION,
      outcome,
    });
  }
}
