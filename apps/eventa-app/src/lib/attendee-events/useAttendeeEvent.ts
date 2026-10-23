import { useQuery } from '@tanstack/react-query';

import { getAttendeeTicketCatalogue, getPublishedEvent } from './attendee-event.service';

export function usePublishedEvent(eventId: string, enabled = true) {
  return useQuery({
    enabled: enabled && eventId.length > 0,
    queryKey: ['events', 'published', eventId],
    queryFn: ({ signal }) => getPublishedEvent(eventId, signal),
    retry: false,
  });
}

export const useAttendeeEvent = usePublishedEvent;

export function useAttendeeTicketCatalogue(eventId: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && eventId.length > 0,
    queryKey: ['events', 'ticket-options', eventId],
    queryFn: ({ signal }) => getAttendeeTicketCatalogue(eventId, signal),
    retry: false,
  });
}
