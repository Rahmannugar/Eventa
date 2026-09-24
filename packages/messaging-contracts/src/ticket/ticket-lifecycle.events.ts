export const TICKET_CHECK_IN_TOPIC = 'eventa.ticket.check-in.v1';

export const TICKET_REVOKED_TOPIC = 'eventa.ticket.revoked.v1';

export const TICKET_CHECKED_IN_EVENT_TYPE = 'ticket.checked-in.v1';

export const TICKET_REVOKED_EVENT_TYPE = 'ticket.revoked.v1';

export interface TicketCheckedInEvent {
  messageId: string;
  eventId: string;
  ticketId: string;
  attendeeId: string;
  checkedInAt: string;
  type: typeof TICKET_CHECKED_IN_EVENT_TYPE;
}

export interface TicketRevokedEvent {
  messageId: string;
  eventId: string;
  ticketId: string;
  attendeeId: string;
  revokedAt: string;
  type: typeof TICKET_REVOKED_EVENT_TYPE;
}
