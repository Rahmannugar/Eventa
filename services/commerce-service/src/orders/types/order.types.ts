export type CommerceOrderStatus =
  | 'pending_reservation'
  | 'pending_payment'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refunding'
  | 'refunded';

export interface CommerceOrderRecord {
  orderId: string;
  attendeeId: string;
  idempotencyKey: string;
  eventId: string;
  ticketTypeId: string;
  requestedQuantity: number;
  status: CommerceOrderStatus;
  currency: string | null;
  totalMinor: number | null;
  reservationExpiresAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePendingOrderCommand {
  orderId: string;
  attendeeId: string;
  idempotencyKey: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
}

export interface CommerceOrderRepository {
  createPending(input: CreatePendingOrderCommand): Promise<CommerceOrderRecord>;
  findById(orderId: string): Promise<CommerceOrderRecord | undefined>;
  markReserved(input: {
    orderId: string;
    ticketName: string;
    quantity: number;
    unitPriceMinor: number;
    currency: string;
    totalMinor: number;
    reservationExpiresAt: Date;
  }): Promise<CommerceOrderRecord>;
}
