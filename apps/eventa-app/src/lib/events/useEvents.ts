import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  createEvent,
  getAdminEvent,
  listAdminEvents,
  updateDraftEvent,
} from './event.service';
import type {
  AdminEventListPage,
  CreateEventInput,
  UpdateDraftEventCommand,
} from './event.types';

export function adminEventQueryKey(eventId: string) {
  return ['events', 'admin', eventId] as const;
}

export const adminEventListQueryKey = ['events', 'admin', 'list'] as const;

export function useAdminEvents() {
  return useInfiniteQuery<
    AdminEventListPage,
    Error,
    InfiniteData<AdminEventListPage>,
    typeof adminEventListQueryKey,
    string | undefined
  >({
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listAdminEvents(pageParam),
    queryKey: adminEventListQueryKey,
    retry: false,
  });
}

export function useAdminEvent(eventId: string, enabled = true) {
  return useQuery({
    enabled,
    queryFn: () => getAdminEvent(eventId),
    queryKey: adminEventQueryKey(eventId),
    retry: false,
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateEventInput) => createEvent(input),
    onSuccess: (event) => {
      queryClient.setQueryData(adminEventQueryKey(event.eventId), event);
      void queryClient.invalidateQueries({ queryKey: adminEventListQueryKey });
    },
  });
}

export function useUpdateDraftEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (command: UpdateDraftEventCommand) => updateDraftEvent(command),
    onSuccess: (event) => {
      queryClient.setQueryData(adminEventQueryKey(event.eventId), event);
      void queryClient.invalidateQueries({ queryKey: adminEventListQueryKey });
    },
  });
}
