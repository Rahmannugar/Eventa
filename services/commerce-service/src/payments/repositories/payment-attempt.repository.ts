import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import { COMMERCE_DATABASE } from '../../database/database.constants';
import type { CommerceDatabase } from '../../database/database.types';
import {
  paymentAttempts,
  paymentProviderEvents,
} from '../schema/payment-attempt.schema';
import type {
  CreatePaymentAttemptCommand,
  PaymentAttemptRecord,
  PaymentAttemptRepository as PaymentAttemptRepositoryContract,
  ProviderEventApplication,
  ProviderEventRegistration,
} from '../types/payment-attempt.types';
import type { ProviderPaymentIntent } from '../types/payment-provider.port';

const PAYMENT_COLUMNS = {
  paymentId: paymentAttempts.id,
  orderId: paymentAttempts.orderId,
  attendeeId: paymentAttempts.attendeeId,
  amountMinor: paymentAttempts.amountMinor,
  currency: paymentAttempts.currency,
  status: paymentAttempts.status,
  provider: paymentAttempts.provider,
  providerIdempotencyKey: paymentAttempts.providerIdempotencyKey,
  providerPaymentIntentId: paymentAttempts.providerPaymentIntentId,
  providerStatus: paymentAttempts.providerStatus,
  lastProviderEventId: paymentAttempts.lastProviderEventId,
  lastProviderEventCreatedAt: paymentAttempts.lastProviderEventCreatedAt,
  reconcileAfter: paymentAttempts.reconcileAfter,
  reconciliationClaimedUntil: paymentAttempts.reconciliationClaimedUntil,
  reconciliationFailures: paymentAttempts.reconciliationFailures,
  lastReconciledAt: paymentAttempts.lastReconciledAt,
  createdAt: paymentAttempts.createdAt,
  updatedAt: paymentAttempts.updatedAt,
};

type PaymentProjection = Omit<PaymentAttemptRecord, 'provider'> & {
  provider: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PaymentAttemptRepository implements PaymentAttemptRepositoryContract {
  constructor(
    @Inject(COMMERCE_DATABASE)
    private readonly database: CommerceDatabase,
  ) {}

  async createPending(
    input: CreatePaymentAttemptCommand,
  ): Promise<PaymentAttemptRecord> {
    const [created] = await this.database
      .insert(paymentAttempts)
      .values({
        id: input.paymentId,
        orderId: input.orderId,
        attendeeId: input.attendeeId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        providerIdempotencyKey: input.providerIdempotencyKey,
        reconcileAfter: input.reconcileAfter,
      })
      .onConflictDoNothing({ target: paymentAttempts.orderId })
      .returning(PAYMENT_COLUMNS);
    if (created !== undefined) return this.toRecord(created);

    const [existing] = await this.database
      .select(PAYMENT_COLUMNS)
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, input.orderId))
      .limit(1);
    if (existing === undefined) {
      throw new Error('Payment idempotency record missing');
    }
    if (
      existing.attendeeId !== input.attendeeId ||
      existing.amountMinor !== input.amountMinor ||
      existing.currency !== input.currency
    ) {
      throw new Error('Payment order snapshot conflict');
    }
    return this.toRecord(existing);
  }

  async markAwaitingConfirmation(input: {
    paymentId: string;
    providerPaymentIntentId: string;
    providerStatus: string;
  }): Promise<PaymentAttemptRecord> {
    return this.database.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select(PAYMENT_COLUMNS)
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, input.paymentId))
        .limit(1)
        .for('update');
      if (attempt === undefined) throw new Error('Payment attempt disappeared');
      if (
        attempt.providerPaymentIntentId !== null &&
        attempt.providerPaymentIntentId !== input.providerPaymentIntentId
      ) {
        throw new Error('Payment provider identity conflict');
      }
      if (
        attempt.status !== 'provider_pending' &&
        attempt.status !== 'awaiting_confirmation'
      ) {
        return this.toRecord(attempt);
      }

      const now = new Date();
      const [updated] = await transaction
        .update(paymentAttempts)
        .set({
          providerPaymentIntentId: input.providerPaymentIntentId,
          providerStatus: input.providerStatus,
          reconcileAfter: now,
          status: 'awaiting_confirmation',
          updatedAt: now,
        })
        .where(eq(paymentAttempts.id, input.paymentId))
        .returning(PAYMENT_COLUMNS);
      if (updated === undefined) throw new Error('Payment attempt disappeared');
      return this.toRecord(updated);
    });
  }

  async registerProviderEvent(
    input: ProviderEventRegistration,
  ): Promise<'received' | 'duplicate'> {
    const [created] = await this.database
      .insert(paymentProviderEvents)
      .values({
        eventType: input.eventType,
        providerCreatedAt: input.providerCreatedAt,
        providerEventId: input.providerEventId,
        providerObjectId: input.providerObjectId,
      })
      .onConflictDoNothing()
      .returning({ status: paymentProviderEvents.status });
    if (created !== undefined) return 'received';

    const [existing] = await this.database
      .select({ status: paymentProviderEvents.status })
      .from(paymentProviderEvents)
      .where(
        and(
          eq(paymentProviderEvents.provider, 'stripe'),
          eq(paymentProviderEvents.providerEventId, input.providerEventId),
        ),
      )
      .limit(1);
    if (existing === undefined)
      throw new Error('Provider event record missing');
    return existing.status === 'received' ? 'received' : 'duplicate';
  }

  async applyProviderEvent(
    input: ProviderEventApplication,
  ): Promise<'processed' | 'ignored' | 'duplicate'> {
    return this.database.transaction(async (transaction) => {
      const [providerEvent] = await transaction
        .select()
        .from(paymentProviderEvents)
        .where(
          and(
            eq(paymentProviderEvents.provider, 'stripe'),
            eq(paymentProviderEvents.providerEventId, input.providerEventId),
          ),
        )
        .limit(1)
        .for('update');
      if (providerEvent === undefined)
        throw new Error('Provider event record missing');
      if (
        providerEvent.eventType !== input.eventType ||
        providerEvent.providerObjectId !== input.providerObjectId ||
        providerEvent.providerCreatedAt.getTime() !==
          input.providerCreatedAt.getTime()
      ) {
        throw new Error('Provider event identity conflict');
      }
      if (providerEvent.status !== 'received') return 'duplicate';

      const metadataPaymentId = input.intent.metadata.eventa_payment_id ?? '';
      let [attempt] = await transaction
        .select(PAYMENT_COLUMNS)
        .from(paymentAttempts)
        .where(
          eq(
            paymentAttempts.providerPaymentIntentId,
            input.intent.paymentIntentId,
          ),
        )
        .limit(1)
        .for('update');
      if (attempt === undefined && UUID_PATTERN.test(metadataPaymentId)) {
        [attempt] = await transaction
          .select(PAYMENT_COLUMNS)
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, metadataPaymentId))
          .limit(1)
          .for('update');
      }

      const now = new Date();
      if (attempt === undefined) {
        await transaction
          .update(paymentProviderEvents)
          .set({ processedAt: now, status: 'ignored' })
          .where(
            and(
              eq(paymentProviderEvents.provider, 'stripe'),
              eq(paymentProviderEvents.providerEventId, input.providerEventId),
            ),
          );
        return 'ignored';
      }

      this.assertIntentMatches(attempt, input.intent);
      const eventIsOlder =
        attempt.lastProviderEventCreatedAt !== null &&
        input.providerCreatedAt < attempt.lastProviderEventCreatedAt;
      const terminal =
        attempt.status === 'succeeded' || attempt.status === 'canceled';
      if (!eventIsOlder && !terminal) {
        await transaction
          .update(paymentAttempts)
          .set({
            lastProviderEventCreatedAt: input.providerCreatedAt,
            lastProviderEventId: input.providerEventId,
            providerPaymentIntentId: input.intent.paymentIntentId,
            providerStatus: input.intent.status,
            reconcileAfter: input.reconcileAfter,
            reconciliationClaimedUntil: null,
            status: input.status,
            updatedAt: now,
          })
          .where(eq(paymentAttempts.id, attempt.paymentId));
      }
      await transaction
        .update(paymentProviderEvents)
        .set({
          paymentId: attempt.paymentId,
          processedAt: now,
          status: 'processed',
        })
        .where(
          and(
            eq(paymentProviderEvents.provider, 'stripe'),
            eq(paymentProviderEvents.providerEventId, input.providerEventId),
          ),
        );
      return 'processed';
    });
  }

  async claimReconciliationBatch(input: {
    now: Date;
    claimedUntil: Date;
    limit: number;
  }): Promise<PaymentAttemptRecord[]> {
    return this.database.transaction(async (transaction) => {
      const candidates = await transaction
        .select(PAYMENT_COLUMNS)
        .from(paymentAttempts)
        .where(
          and(
            notInArray(paymentAttempts.status, ['succeeded', 'canceled']),
            lte(paymentAttempts.reconcileAfter, input.now),
            or(
              isNull(paymentAttempts.reconciliationClaimedUntil),
              lt(paymentAttempts.reconciliationClaimedUntil, input.now),
            ),
          ),
        )
        .orderBy(paymentAttempts.reconcileAfter, paymentAttempts.id)
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (candidates.length === 0) return [];
      await transaction
        .update(paymentAttempts)
        .set({ reconciliationClaimedUntil: input.claimedUntil })
        .where(
          inArray(
            paymentAttempts.id,
            candidates.map((candidate) => candidate.paymentId),
          ),
        );
      return candidates.map((candidate) => this.toRecord(candidate));
    });
  }

  async applyReconciliation(input: {
    paymentId: string;
    intent: ProviderPaymentIntent;
    now: Date;
    reconcileAfter: Date | null;
    status: Exclude<PaymentAttemptRecord['status'], 'provider_pending'>;
  }): Promise<PaymentAttemptRecord> {
    return this.database.transaction(async (transaction) => {
      const [attempt] = await transaction
        .select(PAYMENT_COLUMNS)
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, input.paymentId))
        .limit(1)
        .for('update');
      if (attempt === undefined) throw new Error('Payment attempt disappeared');
      if (attempt.status === 'succeeded' || attempt.status === 'canceled') {
        return this.toRecord(attempt);
      }
      this.assertIntentMatches(attempt, input.intent);
      const [updated] = await transaction
        .update(paymentAttempts)
        .set({
          lastReconciledAt: input.now,
          providerPaymentIntentId: input.intent.paymentIntentId,
          providerStatus: input.intent.status,
          reconcileAfter: input.reconcileAfter,
          reconciliationClaimedUntil: null,
          reconciliationFailures: 0,
          status: input.status,
          updatedAt: input.now,
        })
        .where(eq(paymentAttempts.id, input.paymentId))
        .returning(PAYMENT_COLUMNS);
      if (updated === undefined) throw new Error('Payment attempt disappeared');
      return this.toRecord(updated);
    });
  }

  async recordReconciliationFailure(input: {
    paymentId: string;
    now: Date;
    reconcileAfter: Date;
  }): Promise<void> {
    await this.database
      .update(paymentAttempts)
      .set({
        lastReconciledAt: input.now,
        reconcileAfter: input.reconcileAfter,
        reconciliationClaimedUntil: null,
        reconciliationFailures: sql`${paymentAttempts.reconciliationFailures} + 1`,
        updatedAt: input.now,
      })
      .where(eq(paymentAttempts.id, input.paymentId));
  }

  private assertIntentMatches(
    attempt: PaymentProjection,
    intent: ProviderPaymentIntent,
  ): void {
    if (
      intent.paymentIntentId === '' ||
      (attempt.providerPaymentIntentId !== null &&
        attempt.providerPaymentIntentId !== intent.paymentIntentId) ||
      intent.amountMinor !== attempt.amountMinor ||
      intent.currency !== attempt.currency ||
      intent.metadata.eventa_order_id !== attempt.orderId ||
      intent.metadata.eventa_payment_id !== attempt.paymentId
    ) {
      throw new Error('PAYMENT_PROVIDER_RESPONSE_INVALID');
    }
  }

  private toRecord(value: PaymentProjection): PaymentAttemptRecord {
    if (value.provider !== 'stripe') {
      throw new Error('Payment provider is unsupported');
    }
    return { ...value, provider: value.provider };
  }
}
