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
