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
  finalize(
    input: EventCapacityTransitionCommand,
  ): Promise<EventCapacityTransitionResult<'finalized' | 'expired'>>;
  release(
    input: EventCapacityTransitionCommand,
  ): Promise<EventCapacityTransitionResult<'released' | 'expired'>>;
}

export type EventCapacityReservationPort = Pick<EventCapacityPort, 'reserve'>;

export interface EventCapacityTransitionCommand {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  requestId: string;
}

export interface EventCapacityTransitionResult<
  Status extends 'finalized' | 'released' | 'expired' =
    | 'finalized'
    | 'released'
    | 'expired',
> {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  status: Status;
  quantity: number;
}
