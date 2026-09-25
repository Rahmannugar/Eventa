import { Injectable, Logger } from '@nestjs/common';
import { recordBusinessOutcome } from '@eventa/observability';

import { REFUND_CLAIM_BATCH_SIZE } from '../constants/cancelled-event-refund.constants';
import { CancelledEventRefundRepository } from '../repositories/cancelled-event-refund.repository';
import type {
  CancelledEventRefundClaim,
  EventCancelledFact,
  EventCancellationHandling,
} from '../types/cancelled-event-refund.types';

@Injectable()
export class EventCancellationRefundService implements CancelledEventRefundClaim {
  private readonly logger = new Logger(EventCancellationRefundService.name);

  constructor(private readonly repository: CancelledEventRefundRepository) {}

  async handleCancellation(
    fact: EventCancelledFact,
  ): Promise<EventCancellationHandling> {
    const claim = await this.repository.claimCancellation({
      eventType: fact.type,
      eventId: fact.eventId,
      messageId: fact.messageId,
    });
    if (claim === 'processed') {
      this.recordOutcome('duplicate');
      return 'duplicate';
    }

    let claimedOrders = 0;
    for (;;) {
      const orderIds = await this.repository.findRefundableOrders({
        eventId: fact.eventId,
        limit: REFUND_CLAIM_BATCH_SIZE,
      });
      if (orderIds.length === 0) break;
      let batchClaims = 0;
      for (const orderId of orderIds) {
        const result = await this.repository.claimOrderCancellation(orderId);
        if (result === 'claimed') {
          batchClaims += 1;
          claimedOrders += 1;
        }
      }
      if (batchClaims === 0) break;
    }

    await this.repository.completeCancellation(fact.messageId);
    this.logger.log({
      event: 'event_cancellation_claimed',
      message_id: fact.messageId,
      event_id: fact.eventId,
      claimed_orders: claimedOrders,
    });
    this.recordOutcome('processed');
    return 'processed';
  }

  async ensureOrderClaimed(input: {
    eventId: string;
    orderId: string;
  }): Promise<'claimed' | 'not_cancelled' | 'not_eligible'> {
    const cancelled = await this.repository.isEventCancellationClaimed(
      input.eventId,
    );
    if (!cancelled) return 'not_cancelled';
    const claim = await this.repository.claimOrderCancellation(input.orderId);
    if (claim === 'claimed') {
      this.logger.log({
        event: 'event_cancellation_claimed_after_payment',
        event_id: input.eventId,
        order_id: input.orderId,
      });
      this.recordOutcome('processed');
      return 'claimed';
    }
    this.recordOutcome('skipped');
    return 'not_eligible';
  }

  private recordOutcome(outcome: string): void {
    recordBusinessOutcome({
      operation: 'commerce.cancelled_event_refund',
      outcome,
    });
  }
}
