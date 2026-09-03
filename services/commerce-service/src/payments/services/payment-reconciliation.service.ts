import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { recordBusinessOutcome } from '@eventa/observability';

import {
  PAYMENT_RECONCILIATION_BATCH_SIZE,
  PAYMENT_RECONCILIATION_CONCURRENCY,
  PAYMENT_RECONCILIATION_INTERVAL_MS,
  PAYMENT_RECONCILIATION_LEASE_MS,
  PAYMENT_RECONCILIATION_MAX_BACKOFF_MS,
} from '../payment-reconciliation.constants';
import type {
  PaymentAttemptRecord,
  PaymentReconciliation,
  PaymentReconciliationRepository,
} from '../types/payment-attempt.types';
import type { PaymentProviderPort } from '../types/payment-provider.port';
import {
  nextPaymentReconciliationAt,
  resolvePaymentAttemptStatus,
} from './payment-provider-state';

export class PaymentReconciliationService
  implements PaymentReconciliation, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly attempts: PaymentReconciliationRepository,
    private readonly provider: PaymentProviderPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.reconcile(),
      PAYMENT_RECONCILIATION_INTERVAL_MS,
    );
    this.timer.unref();
    void this.reconcile();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async reconcile(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = new Date();
      const attempts = await this.attempts.claimReconciliationBatch({
        claimedUntil: new Date(now.getTime() + PAYMENT_RECONCILIATION_LEASE_MS),
        limit: PAYMENT_RECONCILIATION_BATCH_SIZE,
        now,
      });
      for (
        let offset = 0;
        offset < attempts.length;
        offset += PAYMENT_RECONCILIATION_CONCURRENCY
      ) {
        await Promise.all(
          attempts
            .slice(offset, offset + PAYMENT_RECONCILIATION_CONCURRENCY)
            .map((attempt) => this.reconcileAttempt(attempt)),
        );
      }
      return attempts.length;
    } catch (error: unknown) {
      recordBusinessOutcome({
        operation: 'commerce.payment_reconciliation',
        outcome: 'sweep_failed',
      });
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'payment_reconciliation_sweep_failed',
        operation: 'commerce.payment.reconcile_due',
      });
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async reconcileAttempt(attempt: PaymentAttemptRecord): Promise<void> {
    const now = new Date();
    try {
      const intent =
        attempt.providerPaymentIntentId === null
          ? await this.provider.createIntent({
              amountMinor: attempt.amountMinor,
              currency: attempt.currency,
              idempotencyKey: attempt.providerIdempotencyKey,
              orderId: attempt.orderId,
              paymentId: attempt.paymentId,
            })
          : await this.provider.retrieveIntent(attempt.providerPaymentIntentId);
      const status = resolvePaymentAttemptStatus(intent);
      await this.attempts.applyReconciliation({
        intent,
        now,
        paymentId: attempt.paymentId,
        reconcileAfter: nextPaymentReconciliationAt(status, now),
        status,
      });
      recordBusinessOutcome({
        operation: 'commerce.payment_reconciliation',
        outcome: status,
      });
    } catch (error: unknown) {
      const exponent = Math.min(attempt.reconciliationFailures, 6);
      const delay = Math.min(
        PAYMENT_RECONCILIATION_INTERVAL_MS * 2 ** exponent,
        PAYMENT_RECONCILIATION_MAX_BACKOFF_MS,
      );
      await this.attempts.recordReconciliationFailure({
        now,
        paymentId: attempt.paymentId,
        reconcileAfter: new Date(now.getTime() + delay),
      });
      recordBusinessOutcome({
        operation: 'commerce.payment_reconciliation',
        outcome: 'retry_scheduled',
      });
      this.logger.warn({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'payment_reconciliation_retry_scheduled',
        operation: 'commerce.payment.reconcile',
        payment_id: attempt.paymentId,
      });
    }
  }
}
