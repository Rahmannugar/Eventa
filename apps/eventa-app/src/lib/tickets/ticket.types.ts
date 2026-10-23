export interface AttendeeTicket {
  id: string;
  orderId: string;
  eventId: string;
  ticketTypeId: string;
  unitIndex: number;
  status: 'issued' | 'checked_in' | 'revoked';
  issuedAt: string;
  qrToken: string;
}

export interface AttendeeTicketPage {
  tickets: AttendeeTicket[];
  nextBefore: string;
}
