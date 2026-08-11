export interface EventVenue {
  name: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  region?: string | undefined;
  postalCode?: string | undefined;
  countryCode: string;
}

export interface AdminEventMedia {
  mediaId: string;
  slot: 'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';
  url: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
}

export interface AdminEvent {
  eventId: string;
  title: string;
  description?: string | undefined;
  category?: string | undefined;
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

export interface CreateDraftEventInput {
  title: string;
}

export interface UpdateDraftEventInput {
  expectedVersion: number;
  title: string;
  description: string;
  category: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venue: EventVenue;
}

export interface UpdateDraftEventCommand {
  eventId: string;
  input: UpdateDraftEventInput;
}
