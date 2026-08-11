import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createDraftEvent,
  getAdminEvent,
  updateDraftEvent,
} from './event.service';
import type {
  CreateDraftEventInput,
  UpdateDraftEventCommand,
} from './event.types';

export function adminEventQueryKey(eventId: string) {
  return ['events', 'admin', eventId] as const;
}

export function useAdminEvent(eventId: string, enabled = true) {
  return useQuery({
    enabled,
    queryFn: () => getAdminEvent(eventId),
    queryKey: adminEventQueryKey(eventId),
    retry: false,
  });
}

export function useCreateDraftEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateDraftEventInput) => createDraftEvent(input),
    onSuccess: (event) => {
      queryClient.setQueryData(adminEventQueryKey(event.eventId), event);
    },
  });
}

export function useUpdateDraftEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (command: UpdateDraftEventCommand) => updateDraftEvent(command),
    onSuccess: (event) => {
      queryClient.setQueryData(adminEventQueryKey(event.eventId), event);
    },
  });
}
