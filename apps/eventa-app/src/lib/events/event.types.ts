export interface EventVenue {
  name: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  region?: string | undefined;
  regionCode?: string | undefined;
  postalCode?: string | undefined;
  countryCode: string;
}

export type EventMediaSlot =
  'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';

export type EventMediaContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface AdminEventMedia {
  mediaId: string;
  slot: EventMediaSlot;
  url: string;
  contentType: EventMediaContentType;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface AdminEvent {
  eventId: string;
  title: string;
  description?: string | undefined;
  categories: string[];
  startsAt?: string | undefined;
  endsAt?: string | undefined;
  timeZone?: string | undefined;
  venue?: EventVenue | undefined;
  media: AdminEventMedia[];
  status: 'draft' | 'published';
  version: number;
  createdByAdminId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | undefined;
}

export interface EventDetailsInput {
  title: string;
  description: string;
  categories: string[];
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venue: EventVenue;
}

export type CreateEventInput = EventDetailsInput;

export interface UpdateDraftEventInput extends EventDetailsInput {
  expectedVersion: number;
}

export interface UpdateDraftEventCommand {
  eventId: string;
  input: UpdateDraftEventInput;
}

export interface AdminEventSummary {
  eventId: string;
  title: string;
  categories: string[];
  startsAt?: string | undefined;
  endsAt?: string | undefined;
  timeZone?: string | undefined;
  venue?: EventVenue | undefined;
  status: 'draft' | 'published';
  updatedAt: string;
}

export type AdminEventSort =
  'updated_desc' | 'event_date_asc' | 'event_date_desc';

export interface AdminEventListCriteria {
  search: string;
  countryCode: string;
  regionCode: string;
  sort: AdminEventSort;
}

export interface AdminEventListPage {
  events: AdminEventSummary[];
  nextCursor?: string | undefined;
}

export interface CreateEventMediaUploadCommand {
  eventId: string;
  input: {
    expectedVersion: number;
    slot: EventMediaSlot;
    contentType: EventMediaContentType;
    sizeBytes: number;
  };
}

export interface EventMediaUploadIntent {
  uploadId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
  verificationDeadlineAt: string;
}

export interface EventMediaUploadStatus {
  uploadId: string;
  status: 'pending' | 'attached' | 'rejected' | 'conflict' | 'expired';
  slot: EventMediaSlot;
  expiresAt: string;
  verificationDeadlineAt: string;
  attachedEventVersion?: number | undefined;
  failureCode?: string | undefined;
}

export interface RemoveEventMediaCommand {
  eventId: string;
  expectedVersion: number;
  slot: EventMediaSlot;
}

export interface PublishEventCommand {
  eventId: string;
  expectedVersion: number;
}

export interface RetireDraftEventCommand {
  eventId: string;
  expectedVersion: number;
}

export interface EventTicketType {
  ticketTypeId: string;
  eventId: string;
  name: string;
  description?: string | undefined;
  priceMinor: number;
  allocation: number;
  salesStartAt: string;
  salesEndAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventTicketTypeList {
  currency?: string | undefined;
  eventVersion: number;
  ticketTypes: EventTicketType[];
}

export interface CreateEventTicketTypeInput {
  expectedVersion: number;
  name: string;
  description?: string | undefined;
  currency: string;
  priceMinor: number;
  allocation: number;
  salesStartAt: string;
  salesEndAt: string;
}

export interface CreateEventTicketTypeCommand {
  eventId: string;
  input: CreateEventTicketTypeInput;
}

export interface CreateEventTicketTypeResult {
  eventVersion: number;
  ticketType: EventTicketType;
}
