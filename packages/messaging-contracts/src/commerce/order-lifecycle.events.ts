export const COMMERCE_ORDER_TOPIC = 'eventa.commerce.order.v1';

export const COMMERCE_ORDER_PAID_EVENT_TYPE = 'commerce.order-paid.v1';

export const COMMERCE_ORDER_REFUNDED_EVENT_TYPE = 'commerce.order-refunded.v1';

export interface CommerceOrderPaidEvent {
  messageId: string;
  orderId: string;
  attendeeId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  currency: string;
  totalMinor: number;
  paidAt: string;
  type: typeof COMMERCE_ORDER_PAID_EVENT_TYPE;
}

export interface CommerceOrderRefundedEvent {
  messageId: string;
  orderId: string;
  attendeeId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  currency: string;
  totalMinor: number;
  refundedAt: string;
  type: typeof COMMERCE_ORDER_REFUNDED_EVENT_TYPE;
}
