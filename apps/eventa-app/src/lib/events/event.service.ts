import { z } from 'zod';

import { apiRequest } from '../api/api-client';
import type {
  AdminEvent,
  AdminEventListPage,
  AdminEventListCriteria,
  CreateEventMediaUploadCommand,
  CreateEventTicketTypeCommand,
  CreateEventTicketTypeResult,
  DefineEventTicketCurrencyCommand,
  DefineEventTicketCurrencyResult,
  CreateEventInput,
  EventMediaUploadIntent,
  EventMediaUploadStatus,
  EventTicketTypeList,
  PublishEventCommand,
  RemoveEventMediaCommand,
  RetireDraftEventCommand,
  UpdateDraftEventCommand,
} from './event.types';

const eventVenueSchema = z.object({
  name: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().min(1).optional(),
  city: z.string().min(1),
  region: z.string().min(1).optional(),
  regionCode: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,7}$/)
    .optional(),
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

const publishedAdminEventSchema: z.ZodType<AdminEvent> =
  adminEventSchema.superRefine((event, context) => {
    if (event.status !== 'published' || event.publishedAt === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Publication must return the published event.',
        path: ['status'],
      });
    }
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

const eventMediaSlotSchema = z.enum([
  'cover',
  'gallery_1',
  'gallery_2',
  'gallery_3',
  'gallery_4',
]);

const eventMediaUploadIntentSchema: z.ZodType<EventMediaUploadIntent> =
  z.object({
    uploadId: z.uuid(),
    uploadUrl: z.url(),
    requiredHeaders: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime({ offset: true }),
    verificationDeadlineAt: z.iso.datetime({ offset: true }),
  });

const eventMediaUploadStatusSchema: z.ZodType<EventMediaUploadStatus> = z
  .object({
    uploadId: z.uuid(),
    status: z.enum(['pending', 'attached', 'rejected', 'conflict', 'expired']),
    slot: eventMediaSlotSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    verificationDeadlineAt: z.iso.datetime({ offset: true }),
    attachedEventVersion: z.number().int().positive().optional(),
    failureCode: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.status === 'attached' &&
      value.attachedEventVersion === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attached media must include the resulting event version.',
        path: ['attachedEventVersion'],
      });
    }
  });

const removeEventMediaResponseSchema = z.object({
  eventVersion: z.number().int().positive(),
});

const retireDraftEventResponseSchema = z.object({
  eventVersion: z.number().int().min(2),
});

const eventTicketTypeSchema = z.object({
  ticketTypeId: z.uuid(),
  eventId: z.uuid(),
  ticketCurrencyId: z.uuid(),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  priceMinor: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  salesStartAt: z.iso.datetime({ offset: true }),
  salesEndAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const eventTicketCurrencySchema = z.object({
  ticketCurrencyId: z.uuid(),
  eventId: z.uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const eventTicketTypeListSchema: z.ZodType<EventTicketTypeList> = z.object({
  eventVersion: z.number().int().positive(),
  ticketCurrencies: z.array(eventTicketCurrencySchema),
  ticketTypes: z.array(eventTicketTypeSchema).max(20),
});

const createEventTicketTypeResultSchema: z.ZodType<CreateEventTicketTypeResult> =
  z.object({
    eventVersion: z.number().int().min(2),
    ticketType: eventTicketTypeSchema,
  });

const defineEventTicketCurrencyResultSchema: z.ZodType<DefineEventTicketCurrencyResult> =
  z.object({
    eventVersion: z.number().int().min(2),
    ticketCurrency: eventTicketCurrencySchema,
  });

export function createEvent(input: CreateEventInput): Promise<AdminEvent> {
  return apiRequest('/admin/events', {
    body: input,
    method: 'POST',
    responseSchema: adminEventSchema,
  });
}

export function listAdminEvents(
  criteria: AdminEventListCriteria,
  cursor?: string,
): Promise<AdminEventListPage> {
  const search = new URLSearchParams({ limit: '20' });
  if (cursor !== undefined) search.set('cursor', cursor);
  if (criteria.search !== '') search.set('search', criteria.search);
  if (criteria.countryCode !== '')
    search.set('countryCode', criteria.countryCode);
  if (criteria.regionCode !== '') search.set('regionCode', criteria.regionCode);
  search.set('sort', criteria.sort);
  return apiRequest<AdminEventListPage>(`/admin/events?${search.toString()}`, {
    responseSchema: adminEventListPageSchema,
  });
}

export function getAdminEvent(
  eventId: string,
  signal?: AbortSignal,
): Promise<AdminEvent> {
  return apiRequest(`/admin/events/${encodeURIComponent(eventId)}`, {
    responseSchema: adminEventSchema,
    ...(signal === undefined ? {} : { signal }),
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

export function listEventTicketTypes(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventTicketTypeList> {
  return apiRequest(
    `/admin/events/${encodeURIComponent(eventId)}/ticket-types`,
    {
      responseSchema: eventTicketTypeListSchema,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}

export function createEventTicketType({
  eventId,
  input,
}: CreateEventTicketTypeCommand): Promise<CreateEventTicketTypeResult> {
  return apiRequest(
    `/admin/events/${encodeURIComponent(eventId)}/ticket-types`,
    {
      body: input,
      method: 'POST',
      responseSchema: createEventTicketTypeResultSchema,
    },
  );
}

export function defineEventTicketCurrency({
  eventId,
  input,
}: DefineEventTicketCurrencyCommand): Promise<DefineEventTicketCurrencyResult> {
  return apiRequest(
    `/admin/events/${encodeURIComponent(eventId)}/ticket-currencies`,
    {
      body: input,
      method: 'POST',
      responseSchema: defineEventTicketCurrencyResultSchema,
    },
  );
}

export function publishEvent({
  eventId,
  expectedVersion,
}: PublishEventCommand): Promise<AdminEvent> {
  return apiRequest(`/admin/events/${encodeURIComponent(eventId)}/publish`, {
    body: { expectedVersion },
    method: 'POST',
    responseSchema: publishedAdminEventSchema,
  });
}

export async function retireDraftEvent({
  eventId,
  expectedVersion,
}: RetireDraftEventCommand): Promise<void> {
  const search = new URLSearchParams({
    expectedVersion: String(expectedVersion),
  });
  await apiRequest(
    `/admin/events/${encodeURIComponent(eventId)}?${search.toString()}`,
    { method: 'DELETE', responseSchema: retireDraftEventResponseSchema },
  );
}

export function createEventMediaUpload(
  { eventId, input }: CreateEventMediaUploadCommand,
  signal?: AbortSignal,
): Promise<EventMediaUploadIntent> {
  return apiRequest(
    `/admin/events/${encodeURIComponent(eventId)}/media-uploads`,
    {
      body: input,
      method: 'POST',
      responseSchema: eventMediaUploadIntentSchema,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}

export function getEventMediaUpload(
  eventId: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<EventMediaUploadStatus> {
  return apiRequest(
    `/admin/events/${encodeURIComponent(eventId)}/media-uploads/${encodeURIComponent(uploadId)}`,
    {
      responseSchema: eventMediaUploadStatusSchema,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}

export async function removeEventMedia({
  eventId,
  expectedVersion,
  slot,
}: RemoveEventMediaCommand): Promise<number> {
  const search = new URLSearchParams({
    expectedVersion: String(expectedVersion),
  });
  const response = await apiRequest(
    `/admin/events/${encodeURIComponent(eventId)}/media/${encodeURIComponent(slot)}?${search.toString()}`,
    { method: 'DELETE', responseSchema: removeEventMediaResponseSchema },
  );
  return response.eventVersion;
}

export function uploadEventMedia(
  intent: EventMediaUploadIntent,
  file: File,
  onProgress: XMLHttpRequestUpload['onprogress'],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();

    request.open('PUT', intent.uploadUrl);
    for (const [name, value] of Object.entries(intent.requiredHeaders)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.call(request, event);
      }
    });
    request.addEventListener('load', () => {
      signal.removeEventListener('abort', abort);
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error('EVENT_MEDIA_STORAGE_UPLOAD_FAILED'));
    });
    request.addEventListener('error', () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('EVENT_MEDIA_STORAGE_UPLOAD_FAILED'));
    });
    request.addEventListener('abort', () => {
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Upload aborted', 'AbortError'));
    });
    signal.addEventListener('abort', abort, { once: true });
    request.send(file);
  });
}
