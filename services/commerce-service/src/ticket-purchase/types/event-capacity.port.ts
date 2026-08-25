export interface EventCapacityQuote {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  attendeeId: string;
  quantity: number;
  expiresAt: Date;
  ticketName: string;
  currency: string;
  unitPriceMinor: number;
}

export interface EventCapacityPort {
  reserve(input: {
    reservationId: string;
    eventId: string;
    ticketTypeId: string;
    attendeeId: string;
    quantity: number;
    requestId: string;
  }): Promise<EventCapacityQuote>;
}
