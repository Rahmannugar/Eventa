export interface EventCancelledFact {
  messageId: string;
  eventId: string;
  cancelledAt: string;
  type: 'event.cancelled.v1';
}

export type ParsedEventLifecycleFact =
  | { kind: 'accepted'; fact: EventCancelledFact }
  | { kind: 'foreign'; type: string }
  | { kind: 'rejected' };

export type CancellationInboxClaim = 'claimed' | 'processed';

export type EventCancellationHandling = 'processed' | 'duplicate';

export type OrderCancellationClaim = 'claimed' | 'not_eligible';

export interface CancelledEventRefundClaim {
  ensureOrderClaimed(input: {
    eventId: string;
    orderId: string;
  }): Promise<'claimed' | 'not_cancelled' | 'not_eligible'>;
}
