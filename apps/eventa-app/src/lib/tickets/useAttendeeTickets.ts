import { useInfiniteQuery } from '@tanstack/react-query';

import { listAttendeeTickets } from './ticket.service';
import type { AttendeeTicketPage } from './ticket.types';

export function useAttendeeTickets(attendeeId: string, awaitingOrderId?: string, pollUntil?: number) {
  return useInfiniteQuery({
    enabled: attendeeId.length > 0,
    getNextPageParam: (page: AttendeeTicketPage) => page.nextBefore || undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listAttendeeTickets(pageParam, signal),
    queryKey: ['attendee', 'tickets', attendeeId] as const,
    refetchInterval: (query) => {
      if (awaitingOrderId === undefined || pollUntil === undefined || Date.now() >= pollUntil) return false;
      const pages = query.state.data?.pages ?? [];
      return pages.some((page) => page.tickets.some((ticket) => ticket.orderId === awaitingOrderId)) ? false : 3000;
    },
    retry: false,
  });
}
