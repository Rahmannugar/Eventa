import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { searchEvents } from './discovery.service';
import type { EventSearchCriteria } from './discovery.types';

export function useEventSearch(criteria: EventSearchCriteria) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => searchEvents(criteria, signal),
    queryKey: ['events', 'search', criteria],
    retry: false,
  });
}
