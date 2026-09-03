import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { recordBusinessOutcome } from '@eventa/observability';

import type { OrderRepository } from '../../orders/repositories/order.repository';
import type { PaymentAttemptRepository } from '../../payments/repositories/payment-attempt.repository';
import type { PaymentProviderPort } from '../../payments/types/payment-provider.port';
import type { EventCapacityPort } from '../types/event-capacity.port';

const BATCH_SIZE = 25;
const LEASE_MS = 120_000;
const SWEEP_MS = 10_000;
const ATTENTION_FAILURE_COUNT = 5;

export class TicketPurchaseExpiryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TicketPurchaseExpiryService.name);
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: PaymentAttemptRepository,
    private readonly provider: PaymentProviderPort,
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
      const rows = await this.orders.claimExpired({
        claimedUntil: new Date(now.getTime() + LEASE_MS),
        limit: BATCH_SIZE,
        now,
      });
      for (const order of rows) await this.expire(order);
      return rows.length;
    } catch (error: unknown) {
      recordBusinessOutcome({
        operation: 'commerce.ticket_purchase_expiry',
        outcome: 'sweep_failed',
      });
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'ticket_purchase_expiry_sweep_failed',
        operation: 'commerce.ticket_purchase.expire_due',
      });
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async expire(order: {
    orderId: string;
    eventId: string;
    ticketTypeId: string;
    expiryFailures?: number;
  }): Promise<void> {
    try {
      const payment = await this.payments.findByOrderId(order.orderId);
      if (payment === undefined) throw new Error('PAYMENT_NOT_FOUND');
      if (payment.status === 'succeeded') {
        this.recordOutcome('payment_succeeded');
        return;
      }
      if (payment.providerPaymentIntentId !== null) {
        const intent = await this.provider.retrieveIntent(payment.providerPaymentIntentId);
        if (intent.status === 'succeeded') {
          this.recordOutcome('payment_succeeded');
          return;
        }
        if (intent.status !== 'canceled') {
          if (this.provider.cancelIntent === undefined) throw new Error('PAYMENT_CANCEL_UNAVAILABLE');
          await this.provider.cancelIntent(payment.providerPaymentIntentId);
        }
      }
      const result = await this.capacity.release({
        eventId: order.eventId,
        requestId: `purchase-expiry:${order.orderId}`,
        reservationId: order.orderId,
        ticketTypeId: order.ticketTypeId,
      });
      if (result.status === 'expired' || result.status === 'released') {
        await this.orders.markExpired(order.orderId);
        this.recordOutcome('expired');
      }
    } catch (error: unknown) {
      await this.orders.releaseExpiryClaim({ orderId: order.orderId, failed: true });
      const failures = (order.expiryFailures ?? 0) + 1;
      const attentionRequired = failures >= ATTENTION_FAILURE_COUNT;
      this.recordOutcome(
        attentionRequired ? 'attention_required' : 'retry_scheduled',
      );
      const details = {
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: attentionRequired
          ? 'ticket_purchase_expiry_attention_required'
          : 'ticket_purchase_expiry_retry_scheduled',
        operation: 'commerce.ticket_purchase.expire',
        order_id: order.orderId,
      };
      if (attentionRequired) this.logger.error(details);
      else this.logger.warn(details);
    }
  }

  private recordOutcome(outcome: string): void {
    recordBusinessOutcome({
      operation: 'commerce.ticket_purchase_expiry',
      outcome,
    });
  }
}
