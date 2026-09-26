import type { TICKET_REVOKED_EVENT_TYPE } from '@eventa/messaging-contracts/ticket/ticket-lifecycle.events';

export interface TicketRevokedFact {
  attendeeId: string;
  eventId: string;
  messageId: string;
  revokedAt: string;
  ticketId: string;
  type: typeof TICKET_REVOKED_EVENT_TYPE;
}

export type ParsedTicketRevokedFact =
  | { kind: 'accepted'; fact: TicketRevokedFact }
  | { kind: 'foreign'; type: string }
  | { kind: 'rejected' };

export type CancellationEmailIngestOutcome =
  'duplicate' | 'grouped' | 'processed';

export type RevocationRecord =
  | { deliveryId: string; kind: 'created'; messageId: string }
  | { kind: 'duplicate'; messageId: string }
  | { kind: 'grouped'; messageId: string };

export interface CancellationEmailJob {
  deliveryId: string;
  type: string;
}

export type CancellationEmailDeliveryStatus =
  | 'delivered'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'rejected'
  | 'retry_scheduled';

export type CancellationEmailClaim =
  | {
      attendeeId: string;
      attempt: number;
      claimToken: string;
      eventId: string;
      kind: 'claimed';
    }
  | { kind: 'busy'; retryAt: Date }
  | { kind: 'terminal'; status: 'delivered' | 'failed' | 'rejected' };

export type CancellationEmailDeliveryOutcome =
  | { kind: 'delivered' | 'duplicate' | 'failed' | 'rejected' }
  | { kind: 'retry'; retryAt: Date };

export interface CancellationEmailDeliveryRepository {
  claim(deliveryId: string): Promise<CancellationEmailClaim>;
  markDelivered(
    deliveryId: string,
    claimToken: string,
    providerMessageId: string,
  ): Promise<boolean>;
  markFailed(
    deliveryId: string,
    claimToken: string,
    failureCode: string,
  ): Promise<boolean>;
  markRetryScheduled(
    deliveryId: string,
    claimToken: string,
    failureCode: string,
    retryAt: Date,
  ): Promise<boolean>;
  recordRejected(deliveryId: string, failureCode: string): Promise<void>;
}
