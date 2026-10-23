import { z } from 'zod';

import { apiRequest } from '../api/api-client';
import type { EventSearchCriteria, EventSearchPage } from './discovery.types';

const eventSearchResultSchema = z.object({
  categories: z.array(z.string()),
  description: z.string().optional(),
  distanceKm: z.number().optional(),
  endsAt: z.string().optional(),
  eventId: z.string(),
  startsAt: z.string().optional(),
  timeZone: z.string().optional(),
  title: z.string(),
  venueCity: z.string().optional(),
  venueCountryCode: z.string().optional(),
  venueName: z.string().optional(),
  venueLatitude: z.number().min(-90).max(90).optional(),
  venueLongitude: z.number().min(-180).max(180).optional(),
});

const eventSearchPageSchema = z.object({
  events: z.array(eventSearchResultSchema),
  limit: z.number().int(),
  offset: z.number().int(),
  total: z.number().int(),
});

export function searchEvents(
  criteria: EventSearchCriteria,
  signal?: AbortSignal,
): Promise<EventSearchPage> {
  const params = new URLSearchParams({ limit: '20', offset: String(criteria.offset ?? 0) });
  const query = criteria.query.trim();
  if (query !== '') params.set('query', query);
  if (criteria.near !== undefined) {
    params.set(
      'near',
      `${String(criteria.near.latitude)},${String(criteria.near.longitude)},${String(criteria.near.radiusKm)}`,
    );
  }
  return apiRequest<EventSearchPage>(`/search/events?${params.toString()}`, {
    responseSchema: eventSearchPageSchema,
    ...(signal === undefined ? {} : { signal }),
  });
}
