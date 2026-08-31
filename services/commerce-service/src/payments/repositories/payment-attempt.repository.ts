import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { COMMERCE_DATABASE } from '../../database/database.constants';
import type { CommerceDatabase } from '../../database/database.types';
import { paymentAttempts } from '../schema/payment-attempt.schema';
import type {
  CreatePaymentAttemptCommand,
  PaymentAttemptRecord,
  PaymentAttemptRepository as PaymentAttemptRepositoryContract,
} from '../types/payment-attempt.types';

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
  createdAt: paymentAttempts.createdAt,
  updatedAt: paymentAttempts.updatedAt,
};

type PaymentProjection = Omit<PaymentAttemptRecord, 'provider'> & {
  provider: string;
};

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
        attempt.status === 'awaiting_confirmation' &&
        attempt.providerPaymentIntentId !== input.providerPaymentIntentId
      ) {
        throw new Error('Payment provider identity conflict');
      }

      const [updated] = await transaction
        .update(paymentAttempts)
        .set({
          providerPaymentIntentId: input.providerPaymentIntentId,
          providerStatus: input.providerStatus,
          status: 'awaiting_confirmation',
          updatedAt: new Date(),
        })
        .where(eq(paymentAttempts.id, input.paymentId))
        .returning(PAYMENT_COLUMNS);
      if (updated === undefined) throw new Error('Payment attempt disappeared');
      return this.toRecord(updated);
    });
  }

  private toRecord(value: PaymentProjection): PaymentAttemptRecord {
    if (value.provider !== 'stripe') {
      throw new Error('Payment provider is unsupported');
    }
    return { ...value, provider: value.provider };
  }
}
