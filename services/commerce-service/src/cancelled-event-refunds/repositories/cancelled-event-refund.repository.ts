import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';

import { COMMERCE_DATABASE } from '../../database/database.constants';
import type { CommerceDatabase } from '../../database/database.types';
import { commerceEventCancellationInbox } from '../schema/event-cancellation-inbox.schema';
import { commerceOrders } from '../../orders/schema/order.schema';
import {
  paymentAttempts,
  paymentWorkflowOutcomes,
} from '../../payments/schema/payment-attempt.schema';
import type {
  CancellationInboxClaim,
  OrderCancellationClaim,
} from '../types/cancelled-event-refund.types';

@Injectable()
export class CancelledEventRefundRepository {
  constructor(
    @Inject(COMMERCE_DATABASE)
    private readonly database: CommerceDatabase,
  ) {}

  async claimCancellation(input: {
    messageId: string;
    eventId: string;
    eventType: string;
  }): Promise<CancellationInboxClaim> {
    const [inserted] = await this.database
      .insert(commerceEventCancellationInbox)
      .values({
        eventType: input.eventType,
        eventId: input.eventId,
        messageId: input.messageId,
      })
      .onConflictDoNothing()
      .returning({ messageId: commerceEventCancellationInbox.messageId });
    if (inserted !== undefined) return 'claimed';
    const [existing] = await this.database
      .select({ status: commerceEventCancellationInbox.status })
      .from(commerceEventCancellationInbox)
      .where(eq(commerceEventCancellationInbox.messageId, input.messageId))
      .limit(1);
    if (existing === undefined) return 'claimed';
    return existing.status === 'processed' ? 'processed' : 'claimed';
  }

  async completeCancellation(messageId: string): Promise<void> {
    await this.database
      .update(commerceEventCancellationInbox)
      .set({ processedAt: new Date(), status: 'processed' })
      .where(eq(commerceEventCancellationInbox.messageId, messageId));
  }

  async isEventCancellationClaimed(eventId: string): Promise<boolean> {
    const rows = await this.database
      .select({ messageId: commerceEventCancellationInbox.messageId })
      .from(commerceEventCancellationInbox)
      .where(eq(commerceEventCancellationInbox.eventId, eventId))
      .limit(1);
    return rows.length > 0;
  }

  async findRefundableOrders(input: {
    eventId: string;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.database
      .select({ orderId: commerceOrders.id })
      .from(commerceOrders)
      .innerJoin(
        paymentAttempts,
        eq(paymentAttempts.orderId, commerceOrders.id),
      )
      .where(
        and(
          eq(commerceOrders.eventId, input.eventId),
          eq(commerceOrders.status, 'paid'),
          eq(paymentAttempts.status, 'succeeded'),
        ),
      )
      .orderBy(asc(commerceOrders.id))
      .limit(input.limit);
    return rows.map((row) => row.orderId);
  }

  async claimOrderCancellation(
    orderId: string,
  ): Promise<OrderCancellationClaim> {
    return this.database.transaction(async (transaction) => {
      const [order] = await transaction
        .select({ id: commerceOrders.id, status: commerceOrders.status })
        .from(commerceOrders)
        .where(eq(commerceOrders.id, orderId))
        .limit(1)
        .for('update');
      if (order === undefined || order.status !== 'paid') return 'not_eligible';
      const [payment] = await transaction
        .select({
          id: paymentAttempts.id,
          providerPaymentIntentId: paymentAttempts.providerPaymentIntentId,
          status: paymentAttempts.status,
        })
        .from(paymentAttempts)
        .where(eq(paymentAttempts.orderId, orderId))
        .limit(1);
      if (
        payment === undefined ||
        payment.status !== 'succeeded' ||
        payment.providerPaymentIntentId === null
      ) {
        return 'not_eligible';
      }
      await transaction
        .insert(paymentWorkflowOutcomes)
        .values({
          kind: 'event_cancelled',
          orderId,
          paymentId: payment.id,
        })
        .onConflictDoNothing();
      const [updated] = await transaction
        .update(commerceOrders)
        .set({
          expiryClaimedUntil: null,
          failureCode: null,
          status: 'refunding',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(commerceOrders.id, orderId),
            eq(commerceOrders.status, 'paid'),
          ),
        )
        .returning({ id: commerceOrders.id });
      if (updated === undefined) return 'not_eligible';
      return 'claimed';
    });
  }
}
