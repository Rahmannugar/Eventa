export interface EventSearchResult {
  eventId: string;
  title: string;
  description?: string | undefined;
  startsAt?: string | undefined;
  endsAt?: string | undefined;
  timeZone?: string | undefined;
  categories: string[];
  venueName?: string | undefined;
  venueCity?: string | undefined;
  venueCountryCode?: string | undefined;
  distanceKm?: number | undefined;
}

export interface EventSearchPage {
  events: EventSearchResult[];
  total: number;
  limit: number;
  offset: number;
}

export interface NearPoint {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface EventSearchCriteria {
  query: string;
  near?: NearPoint | undefined;
}
