import type { EventTicketType } from './event.types';
import { localDateTimeToIso } from './event.validation';

export interface TicketTypeFormState {
  capacity: string;
  description: string;
  name: string;
  price: string;
  salesEndAt: string;
  salesStartAt: string;
}

export const emptyTicketTypeForm: TicketTypeFormState = {
  capacity: '',
  description: '',
  name: '',
  price: '',
  salesEndAt: '',
  salesStartAt: '',
};

export function validateTicketType(
  form: TicketTypeFormState,
  currency: string,
  timeZone?: string,
  eventStartsAt?: string,
):
  | { errors: Record<string, string> }
  | {
      capacity: number;
      priceMinor: number;
      salesEndAt: string;
      salesStartAt: string;
      errors?: never;
    } {
  const errors: Record<string, string> = {};
  if (form.name.trim() === '') errors.name = 'Enter a ticket name.';
  const capacity = Number(form.capacity);
  if (!/^\d+$/.test(form.capacity) || capacity < 1 || capacity > 1_000_000)
    errors.capacity = 'Enter between 1 and 1,000,000 tickets.';
  const priceMinor = parsePrice(form.price, currency);
  if (priceMinor === undefined) errors.price = 'Enter a valid price.';
  if (form.salesStartAt === '')
    errors.salesStartAt = 'Choose when sales start.';
  if (form.salesEndAt === '') errors.salesEndAt = 'Choose when sales end.';
  if (timeZone === undefined)
    errors.salesStartAt = 'Set the event time zone first.';
  if (
    Object.keys(errors).length > 0 ||
    timeZone === undefined ||
    priceMinor === undefined
  )
    return { errors };
  try {
    const salesStartAt = localDateTimeToIso(form.salesStartAt, timeZone);
    const salesEndAt = localDateTimeToIso(form.salesEndAt, timeZone);
    if (salesEndAt <= salesStartAt)
      return { errors: { salesEndAt: 'Sales must end after they start.' } };
    if (eventStartsAt !== undefined && salesEndAt > eventStartsAt)
      return { errors: { salesEndAt: 'Sales must end by the event start.' } };
    return { capacity, priceMinor, salesEndAt, salesStartAt };
  } catch {
    return { errors: { salesStartAt: 'Choose valid dates and times.' } };
  }
}

function parsePrice(value: string, currency: string): number | undefined {
  const digits = currencyDigits(currency);
  const match = new RegExp(
    digits === 0 ? '^(\\d+)$' : `^(\\d+)(?:\\.(\\d{1,${String(digits)}}))?$`,
  ).exec(value.trim());
  if (match === null) return undefined;
  const minor = Number(`${match[1]}${(match[2] ?? '').padEnd(digits, '0')}`);
  return Number.isSafeInteger(minor) && minor <= 2_147_483_647
    ? minor
    : undefined;
}

export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function formatPriceInput(value: number, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return String(value);
  const factor = 10 ** digits;
  return `${String(Math.floor(value / factor))}.${String(value % factor).padStart(digits, '0')}`;
}

export function formatCapacityTotal(ticketTypes: EventTicketType[]): string {
  return ticketTypes
    .reduce((total, ticketType) => total + ticketType.capacity, 0)
    .toLocaleString();
}
