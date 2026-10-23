export interface PublishedEvent {
  eventId: string;
  title: string;
  description: string;
  categories: string[];
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venue: {
    name: string;
    addressLine1: string;
    addressLine2?: string | undefined;
    city: string;
    region?: string | undefined;
    postalCode?: string | undefined;
    countryCode: string;
    latitude?: number | undefined;
    longitude?: number | undefined;
  };
  media: {
    mediaId: string;
    slot: 'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';
    url: string;
    contentType: 'image/jpeg' | 'image/png' | 'image/webp';
    sizeBytes: number;
    width: number;
    height: number;
  }[];
  publishedAt: string;
  version: number;
}

export interface AttendeeTicketOption {
  ticketTypeId: string;
  name: string;
  description?: string | undefined;
  priceMinor: number;
  salesStartAt: string;
  salesEndAt: string;
  availability: {
    status: 'available' | 'waiting' | 'eligible' | 'reserved' | 'unavailable';
    quantity: number;
    salesOpen: boolean;
    canJoinWaitlist: boolean;
    waitlistPosition?: number | undefined;
    opportunityExpiresAt?: string | undefined;
    reservationExpiresAt?: string | undefined;
  };
}

export interface AttendeeTicketCatalogue {
  eventId: string;
  currencies: { currency: string; ticketTypes: AttendeeTicketOption[] }[];
}
