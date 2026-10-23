import { z } from 'zod';

import { apiRequest } from '../api/api-client';
import type { AttendeeTicketCatalogue, PublishedEvent } from './attendee-event.types';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

const publishedEventSchema: z.ZodType<PublishedEvent> = z.object({
  eventId: uuid,
  title: z.string().min(1),
  description: z.string().min(1),
  categories: z.array(z.string().min(1)).min(1),
  startsAt: timestamp,
  endsAt: timestamp,
  timeZone: z.string().min(1),
  venue: z.object({
    name: z.string().min(1),
    addressLine1: z.string().min(1),
    addressLine2: z.string().optional(),
    city: z.string().min(1),
    region: z.string().optional(),
    postalCode: z.string().optional(),
    countryCode: z.string().length(2),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }),
  media: z.array(z.object({
    mediaId: uuid,
    slot: z.enum(['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4']),
    url: z.url(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })),
  publishedAt: timestamp,
  version: z.number().int().min(2),
});

const attendeeTicketCatalogueSchema: z.ZodType<AttendeeTicketCatalogue> = z.object({
  eventId: uuid,
  currencies: z.array(z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    ticketTypes: z.array(z.object({
      ticketTypeId: uuid,
      name: z.string().min(1),
      description: z.string().optional(),
      priceMinor: z.number().int().nonnegative(),
      salesStartAt: timestamp,
      salesEndAt: timestamp,
      availability: z.object({
        status: z.enum(['available', 'waiting', 'eligible', 'reserved', 'unavailable']),
        quantity: z.number().int().nonnegative(),
        salesOpen: z.boolean(),
        canJoinWaitlist: z.boolean(),
        waitlistPosition: z.number().int().positive().optional(),
        opportunityExpiresAt: timestamp.optional(),
        reservationExpiresAt: timestamp.optional(),
      }),
    })),
  })),
});

export function getPublishedEvent(eventId: string, signal?: AbortSignal) {
  return apiRequest(`/events/${encodeURIComponent(eventId)}`, {
    responseSchema: publishedEventSchema,
    ...(signal ? { signal } : {}),
  });
}

export async function getAttendeeTicketCatalogue(eventId: string, signal?: AbortSignal) {
  const result = await apiRequest(`/events/${encodeURIComponent(eventId)}/ticket-options`, {
    responseSchema: attendeeTicketCatalogueSchema,
    ...(signal ? { signal } : {}),
  });
  if (result.eventId !== eventId) throw new Error('Event ticket options do not match this event.');
  return result;
}
