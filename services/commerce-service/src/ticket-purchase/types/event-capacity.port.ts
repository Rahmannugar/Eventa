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
  finalize?(input: EventCapacityTransitionCommand): Promise<EventCapacityTransitionResult>;
  release?(input: EventCapacityTransitionCommand): Promise<EventCapacityTransitionResult>;
}

export interface EventCapacityTransitionCommand {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  requestId: string;
}

export interface EventCapacityTransitionResult {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  status: 'finalized' | 'released' | 'expired';
  quantity: number;
}
