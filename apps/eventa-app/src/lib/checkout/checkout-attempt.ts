import { z } from 'zod';

const attemptSchema = z.object({
  attendeeId: z.uuid(),
  key: z.uuid(),
  eventId: z.uuid(),
  ticketTypeId: z.uuid(),
  quantity: z.number().int().positive(),
  orderId: z.uuid().optional(),
});

export type CheckoutAttempt = z.infer<typeof attemptSchema>;

function storageKey(input: Pick<CheckoutAttempt, 'attendeeId' | 'eventId' | 'ticketTypeId' | 'quantity'>): string {
  return `eventa.checkout.${input.attendeeId}.${input.eventId}.${input.ticketTypeId}.${input.quantity}`;
}

export function readCheckoutAttempt(input: Pick<CheckoutAttempt, 'attendeeId' | 'eventId' | 'ticketTypeId' | 'quantity'>): CheckoutAttempt | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey(input));
    if (raw === null) return undefined;
    const result = attemptSchema.safeParse(JSON.parse(raw));
    if (!result.success || result.data.attendeeId !== input.attendeeId || result.data.eventId !== input.eventId || result.data.ticketTypeId !== input.ticketTypeId || result.data.quantity !== input.quantity) return undefined;
    return result.data;
  } catch {
    return undefined;
  }
}

export function writeCheckoutAttempt(attempt: CheckoutAttempt): void {
  try {
    sessionStorage.setItem(storageKey(attempt), JSON.stringify(attempt));
  } catch {
    // The in-memory attempt remains usable when browser storage is disabled.
  }
}

export function clearCheckoutAttempt(attempt: CheckoutAttempt): void {
  try {
    sessionStorage.removeItem(storageKey(attempt));
  } catch {
    // A disabled storage area needs no cleanup.
  }
}
