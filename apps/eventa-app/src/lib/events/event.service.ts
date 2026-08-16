import { z } from 'zod';

import { apiRequest } from '../api/api-client';
import type {
  AdminEvent,
  AdminEventListPage,
  CreateEventInput,
  UpdateDraftEventCommand,
} from './event.types';

const eventVenueSchema = z.object({
  name: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().min(1).optional(),
  city: z.string().min(1),
  region: z.string().min(1).optional(),
  postalCode: z.string().min(1).optional(),
  countryCode: z.string().length(2),
});

const eventMediaSchema = z.object({
  mediaId: z.uuid(),
  slot: z.enum(['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4']),
  url: z.url(),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const adminEventSchema = z.object({
  eventId: z.uuid(),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  categories: z.array(z.string().min(1)).max(5),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  timeZone: z.string().min(1).optional(),
  venue: eventVenueSchema.optional(),
  media: z.array(eventMediaSchema).max(5),
  status: z.enum(['draft', 'published']),
  version: z.number().int().positive(),
  createdByAdminId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
});

const adminEventSummarySchema = adminEventSchema.pick({
  eventId: true,
  title: true,
  categories: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  venue: true,
  status: true,
  updatedAt: true,
});

const adminEventListPageSchema: z.ZodType<AdminEventListPage> = z.object({
  events: z.array(adminEventSummarySchema),
  nextCursor: z.string().min(1).optional(),
});

export function createEvent(input: CreateEventInput): Promise<AdminEvent> {
  return apiRequest('/admin/events', {
    body: input,
    method: 'POST',
    responseSchema: adminEventSchema,
  });
}

export function listAdminEvents(cursor?: string): Promise<AdminEventListPage> {
  const search = new URLSearchParams({ limit: '20' });
  if (cursor !== undefined) search.set('cursor', cursor);
  return apiRequest<AdminEventListPage>(`/admin/events?${search.toString()}`, {
    responseSchema: adminEventListPageSchema,
  });
}

export function getAdminEvent(eventId: string): Promise<AdminEvent> {
  return apiRequest(`/admin/events/${encodeURIComponent(eventId)}`, {
    responseSchema: adminEventSchema,
  });
}

export function updateDraftEvent({
  eventId,
  input,
}: UpdateDraftEventCommand): Promise<AdminEvent> {
  return apiRequest(`/admin/events/${encodeURIComponent(eventId)}`, {
    body: input,
    method: 'PUT',
    responseSchema: adminEventSchema,
  });
}
