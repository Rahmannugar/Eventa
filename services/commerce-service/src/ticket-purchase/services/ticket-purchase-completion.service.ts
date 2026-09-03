import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { OrderRepository } from '../../orders/repositories/order.repository';
import type { PaymentAttemptRepository } from '../../payments/repositories/payment-attempt.repository';
import type { PaymentWorkflowOutcomeRecord } from '../../payments/types/payment-attempt.types';
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
        if (result.status === 'expired') throw new Error('CAPACITY_EXPIRED_AFTER_PAYMENT');
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
}
