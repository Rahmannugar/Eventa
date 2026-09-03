export const COMMERCE_ORDER_LIFECYCLE_TOPIC =
  'eventa.commerce.order-lifecycle.v1';

export const COMMERCE_ORDER_PAID_EVENT_TYPE = 'commerce.order-paid.v1';

export interface CommerceOrderPaidEvent {
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
