import type { CommerceOrderRecord } from '../../orders/types/order.types';

export interface StartTicketPurchaseCommand {
  attendeeId: string;
  idempotencyKey: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  requestId: string;
}

export interface TicketPurchaseManagement {
  start(input: StartTicketPurchaseCommand): Promise<CommerceOrderRecord>;
}
