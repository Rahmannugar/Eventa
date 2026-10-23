import { z } from 'zod';

import { apiRequest } from '../api/api-client';

const orderSchema = z.object({
  orderId: z.uuid(),
  eventId: z.uuid(),
  ticketTypeId: z.uuid(),
  quantity: z.number().int().positive(),
  status: z.string(),
  currency: z.string().optional(),
  totalMinor: z.number().int().optional(),
  reservationExpiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const checkoutSchema = orderSchema.extend({
  payment: z.object({ paymentId: z.uuid(), clientSecret: z.string().min(1) }),
});

const eventSchema = z.object({
  eventId: z.uuid(),
  title: z.string(),
  startsAt: z.string(),
  timeZone: z.string(),
  venue: z.object({ name: z.string(), city: z.string(), countryCode: z.string() }),
}).passthrough();

const ticketOptionsSchema = z.object({
  eventId: z.uuid(),
  currencies: z.array(z.object({
    currency: z.string(),
    ticketTypes: z.array(z.object({
      ticketTypeId: z.uuid(),
      name: z.string(),
      priceMinor: z.number().int().nonnegative(),
      availability: z.object({
        status: z.enum(['available', 'waiting', 'eligible', 'reserved', 'unavailable']),
        quantity: z.number().int().nonnegative(),
        salesOpen: z.boolean(),
      }).passthrough(),
    }).passthrough()),
  })),
});

export type CheckoutOrder = z.infer<typeof orderSchema>;
export type CheckoutStart = z.infer<typeof checkoutSchema>;
export type CheckoutEvent = z.infer<typeof eventSchema>;
export type CheckoutTicketOptions = z.infer<typeof ticketOptionsSchema>;

export function startCheckout(input: {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  idempotencyKey: string;
}): Promise<CheckoutStart> {
  return apiRequest('/checkout', {
    method: 'POST',
    body: input,
    responseSchema: checkoutSchema,
  });
}

export function getCheckoutOrder(orderId: string, signal?: AbortSignal): Promise<CheckoutOrder> {
  return apiRequest(`/checkout/${encodeURIComponent(orderId)}`, {
    responseSchema: orderSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getCheckoutEvent(eventId: string, signal?: AbortSignal): Promise<CheckoutEvent> {
  return apiRequest(`/events/${encodeURIComponent(eventId)}`, {
    responseSchema: eventSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function getCheckoutTicketOptions(eventId: string, signal?: AbortSignal): Promise<CheckoutTicketOptions> {
  return apiRequest(`/events/${encodeURIComponent(eventId)}/ticket-options`, {
    responseSchema: ticketOptionsSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function isFinalOrder(status: string): boolean {
  return ['paid', 'failed', 'expired', 'refunded'].includes(status);
}

export function formatMoney(minor: number, currency: string): string {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    const scale = 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2);
    return formatter.format(minor / scale);
  } catch {
    return `${currency} ${minor}`;
  }
}
