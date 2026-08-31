import type { CommerceOrderRecord } from '../../orders/types/order.types';
import type { PaymentConfirmation } from '../../payments/types/payment-attempt.types';

export interface StartTicketPurchaseCommand {
  attendeeId: string;
  idempotencyKey: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  requestId: string;
}

export interface TicketPurchaseManagement {
  start(input: StartTicketPurchaseCommand): Promise<StartTicketPurchaseResult>;
}

export interface StartTicketPurchaseResult {
  order: CommerceOrderRecord;
  payment: PaymentConfirmation;
}
