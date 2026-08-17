import { z } from 'zod';

import type {
  AdminEvent,
  CreateEventInput,
  UpdateDraftEventInput,
} from './event.types';
import { regionCodeForName } from '../location/location-data';

export interface DraftEventFormValues {
  title: string;
  description: string;
  categories: string[];
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venueName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  regionCode: string;
  postalCode: string;
  countryCode: string;
}

export type DraftEventFormErrors = Partial<
  Record<keyof DraftEventFormValues, string>
>;

const formSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter an event title.').max(160),
    description: z.string().trim().min(1, 'Describe the event.').max(10_000),
    categories: z
      .array(z.string().trim().min(1).max(80))
      .min(1, 'Choose at least one category.')
      .max(5, 'Choose no more than five categories.'),
    startsAt: z.string().min(1, 'Choose a start date and time.'),
    endsAt: z.string().min(1, 'Choose an end date and time.'),
    timeZone: z
      .string()
      .trim()
      .min(1, 'Enter the event time zone.')
      .max(64)
      .refine(isTimeZone, 'Enter a valid time zone.'),
    venueName: z.string().trim().min(1, 'Enter a venue name.').max(160),
    addressLine1: z.string().trim().min(1, 'Enter the venue address.').max(200),
    addressLine2: z.string().trim().max(200),
    city: z.string().trim().min(1, 'Enter a city.').max(120),
    region: z.string().trim().max(120),
    regionCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^$|^[A-Z0-9][A-Z0-9-]{0,7}$/),
    postalCode: z.string().trim().max(32),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Choose a country.'),
  })
  .superRefine((value, context) => {
    try {
      const startsAt = localDateTimeToIso(value.startsAt, value.timeZone);
      const endsAt = localDateTimeToIso(value.endsAt, value.timeZone);
      if (Date.parse(endsAt) <= Date.parse(startsAt)) {
        context.addIssue({
          code: 'custom',
          message: 'End time must be after the start time.',
          path: ['endsAt'],
        });
      }
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Check the date, time, and time zone.',
        path: ['startsAt'],
      });
    }
  });

export function draftEventFormValues(event: AdminEvent): DraftEventFormValues {
  const timeZone = event.timeZone ?? deviceTimeZone();

  return {
    title: event.title,
    description: event.description ?? '',
    categories: event.categories,
    startsAt:
      event.startsAt === undefined
        ? ''
        : isoToLocalDateTime(event.startsAt, timeZone),
    endsAt:
      event.endsAt === undefined
        ? ''
        : isoToLocalDateTime(event.endsAt, timeZone),
    timeZone,
    venueName: event.venue?.name ?? '',
    addressLine1: event.venue?.addressLine1 ?? '',
    addressLine2: event.venue?.addressLine2 ?? '',
    city: event.venue?.city ?? '',
    region: event.venue?.region ?? '',
    regionCode:
      event.venue?.regionCode ??
      regionCodeForName(
        event.venue?.countryCode ?? '',
        event.venue?.region ?? '',
      ),
    postalCode: event.venue?.postalCode ?? '',
    countryCode: event.venue?.countryCode ?? '',
  };
}

export function emptyEventFormValues(): DraftEventFormValues {
  return {
    title: '',
    description: '',
    categories: [],
    startsAt: '',
    endsAt: '',
    timeZone: deviceTimeZone(),
    venueName: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    region: '',
    regionCode: '',
    postalCode: '',
    countryCode: '',
  };
}

export function validateCreateEventForm(
  values: DraftEventFormValues,
):
  | { success: true; data: CreateEventInput }
  | { success: false; errors: DraftEventFormErrors } {
  return validateEventForm(values);
}

export function validateDraftEventForm(
  values: DraftEventFormValues,
  expectedVersion: number,
):
  | { success: true; data: UpdateDraftEventInput }
  | { success: false; errors: DraftEventFormErrors } {
  const result = validateEventForm(values);
  if (!result.success) return result;
  return {
    success: true,
    data: { ...result.data, expectedVersion },
  };
}

function validateEventForm(
  values: DraftEventFormValues,
):
  | { success: true; data: CreateEventInput }
  | { success: false; errors: DraftEventFormErrors } {
  const result = formSchema.safeParse(values);
  if (!result.success) {
    const errors: DraftEventFormErrors = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && !(field in errors)) {
        errors[field as keyof DraftEventFormValues] = issue.message;
      }
    }
    return { success: false, errors };
  }

  const value = result.data;
  return {
    success: true,
    data: {
      title: value.title,
      description: value.description,
      categories: value.categories,
      startsAt: localDateTimeToIso(value.startsAt, value.timeZone),
      endsAt: localDateTimeToIso(value.endsAt, value.timeZone),
      timeZone: value.timeZone,
      venue: {
        name: value.venueName,
        addressLine1: value.addressLine1,
        ...(value.addressLine2 === ''
          ? {}
          : { addressLine2: value.addressLine2 }),
        city: value.city,
        ...(value.region === '' ? {} : { region: value.region }),
        ...(value.regionCode === '' ? {} : { regionCode: value.regionCode }),
        ...(value.postalCode === '' ? {} : { postalCode: value.postalCode }),
        countryCode: value.countryCode,
      },
    },
  };
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function isoToLocalDateTime(value: string, timeZone: string): string {
  const parts = dateTimeParts(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function localDateTimeToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match === null) throw new Error('Invalid local date and time.');

  const [, year, month, day, hour, minute] = match;
  const desiredUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let instant = desiredUtc;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = dateTimeParts(new Date(instant), timeZone);
    const representedUtc = Date.UTC(
      Number(represented.year),
      Number(represented.month) - 1,
      Number(represented.day),
      Number(represented.hour),
      Number(represented.minute),
    );
    instant += desiredUtc - representedUtc;
  }

  const roundTrip = dateTimeParts(new Date(instant), timeZone);
  const expected = `${year}-${month}-${day}T${hour}:${minute}`;
  const actual = `${roundTrip.year}-${roundTrip.month}-${roundTrip.day}T${roundTrip.hour}:${roundTrip.minute}`;
  if (actual !== expected) throw new Error('Local time does not exist.');

  return new Date(instant).toISOString();
}

function dateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  if (
    values.year === undefined ||
    values.month === undefined ||
    values.day === undefined ||
    values.hour === undefined ||
    values.minute === undefined
  ) {
    throw new Error('Date could not be represented.');
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}
