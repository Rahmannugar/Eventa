import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiError, userFacingApiError } from '../api/api-error';
import {
  EventMediaVerificationTimedOutError,
  waitForEventMediaUpload,
} from './event-media.workflow';
import {
  createEvent,
  createEventMediaUpload,
  getAdminEvent,
  getEventMediaUpload,
  listAdminEvents,
  publishEvent,
  removeEventMedia,
  retireDraftEvent,
  updateDraftEvent,
  uploadEventMedia,
} from './event.service';
import type {
  AdminEvent,
  AdminEventListCriteria,
  AdminEventListPage,
  CreateEventInput,
  EventMediaContentType,
  EventMediaSlot,
  EventMediaUploadStatus,
  PublishEventCommand,
  RetireDraftEventCommand,
  UpdateDraftEventCommand,
} from './event.types';

export function adminEventQueryKey(eventId: string) {
  return ['events', 'admin', eventId] as const;
}

export const adminEventListQueryKey = ['events', 'admin', 'list'] as const;

export function useAdminEvents(criteria: AdminEventListCriteria) {
  const queryKey = [...adminEventListQueryKey, criteria] as const;
  return useInfiniteQuery<
    AdminEventListPage,
    Error,
    InfiniteData<AdminEventListPage>,
    typeof queryKey,
    string | undefined
  >({
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: undefined as string | undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => listAdminEvents(criteria, pageParam),
    queryKey,
    retry: false,
  });
}

export function useAdminEvent(eventId: string, enabled = true) {
  return useQuery({
    enabled,
    queryFn: ({ signal }) => getAdminEvent(eventId, signal),
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

export function usePublishEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (command: PublishEventCommand) => publishEvent(command),
    onSuccess: (event) => {
      queryClient.setQueryData(adminEventQueryKey(event.eventId), event);
      void queryClient.invalidateQueries({ queryKey: adminEventListQueryKey });
    },
  });
}

export function useRetireDraftEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (command: RetireDraftEventCommand) => retireDraftEvent(command),
    onSuccess: (_, command) => {
      queryClient.removeQueries({
        exact: true,
        queryKey: adminEventQueryKey(command.eventId),
      });
      void queryClient.invalidateQueries({ queryKey: adminEventListQueryKey });
    },
  });
}

export type EventMediaOperation =
  | { phase: 'idle' }
  | { phase: 'uploading'; progress: number; slot: EventMediaSlot }
  | { phase: 'verifying'; slot: EventMediaSlot }
  | { phase: 'removing'; slot: EventMediaSlot }
  | { phase: 'refresh_required'; slot: EventMediaSlot }
  | { message: string; phase: 'error'; slot: EventMediaSlot };

const acceptedMediaTypes: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const maximumMediaSizeBytes = 8_388_608;

export function useEventMedia(event: AdminEvent) {
  const queryClient = useQueryClient();
  const controllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const previewUrlRef = useRef<string | null>(null);
  const [operation, setOperation] = useState<EventMediaOperation>({
    phase: 'idle',
  });
  const [preview, setPreview] = useState<{
    slot: EventMediaSlot;
    url: string;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (previewUrlRef.current !== null) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  async function refreshEvent(
    minimumVersion?: number,
    signal?: AbortSignal,
  ): Promise<AdminEvent> {
    const refreshedEvent = await getAdminEvent(event.eventId, signal);
    signal?.throwIfAborted();
    if (
      minimumVersion !== undefined &&
      refreshedEvent.version < minimumVersion
    ) {
      throw new Error('EVENT_MEDIA_EVENT_REFRESH_STALE');
    }
    queryClient.setQueryData(adminEventQueryKey(event.eventId), refreshedEvent);
    void queryClient.invalidateQueries({ queryKey: adminEventListQueryKey });
    return refreshedEvent;
  }

  async function handleUploadResult(
    result: EventMediaUploadStatus,
    signal: AbortSignal,
  ): Promise<void> {
    if (result.status === 'attached') {
      if (result.attachedEventVersion === undefined) {
        throw new Error('EVENT_MEDIA_STATUS_MISMATCH');
      }
      const attachedEventVersion = result.attachedEventVersion;
      queryClient.setQueryData<AdminEvent>(
        adminEventQueryKey(event.eventId),
        (current) =>
          current === undefined
            ? current
            : { ...current, version: attachedEventVersion },
      );
      void queryClient.invalidateQueries({ queryKey: adminEventListQueryKey });
      try {
        await refreshEvent(attachedEventVersion, signal);
      } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        throw new Error('EVENT_MEDIA_REFRESH_REQUIRED', { cause: error });
      }
      return;
    }
    if (result.status === 'conflict') {
      await refreshAfterConflict(() => refreshEvent(undefined, signal));
      throw new Error('EVENT_MEDIA_VERSION_CONFLICT');
    }
    if (result.status === 'expired')
      throw new Error('EVENT_MEDIA_UPLOAD_EXPIRED');
    throw new Error('EVENT_MEDIA_UPLOAD_REJECTED');
  }

  async function chooseFile(slot: EventMediaSlot, file: File): Promise<void> {
    if (busyRef.current || operation.phase !== 'idle') return;
    if (!acceptedMediaTypes.has(file.type) || file.size <= 0) {
      setOperation({
        message: 'Choose a JPEG, PNG, or WebP image.',
        phase: 'error',
        slot,
      });
      return;
    }
    if (file.size > maximumMediaSizeBytes) {
      setOperation({
        message: 'Choose an image smaller than 8 MB.',
        phase: 'error',
        slot,
      });
      return;
    }

    const controller = new AbortController();
    const previewUrl = URL.createObjectURL(file);
    controllerRef.current = controller;
    busyRef.current = true;
    previewUrlRef.current = previewUrl;
    setPreview({ slot, url: previewUrl });
    setOperation({ phase: 'uploading', progress: 0, slot });

    try {
      const intent = await createEventMediaUpload(
        {
          eventId: event.eventId,
          input: {
            contentType: file.type as EventMediaContentType,
            expectedVersion: event.version,
            sizeBytes: file.size,
            slot,
          },
        },
        controller.signal,
      );
      await uploadEventMedia(
        intent,
        file,
        (progressEvent) => {
          if (!mountedRef.current) return;
          setOperation({
            phase: 'uploading',
            progress: Math.min(
              100,
              Math.round((progressEvent.loaded / progressEvent.total) * 100),
            ),
            slot,
          });
        },
        controller.signal,
      );
      setOperation({ phase: 'verifying', slot });
      const result = await waitForEventMediaUpload({
        readStatus: () =>
          getEventMediaUpload(
            event.eventId,
            intent.uploadId,
            controller.signal,
          ),
        signal: controller.signal,
      });
      if (result.uploadId !== intent.uploadId || result.slot !== slot) {
        throw new Error('EVENT_MEDIA_STATUS_MISMATCH');
      }
      await handleUploadResult(result, controller.signal);
      controller.signal.throwIfAborted();
      setOperation({ phase: 'idle' });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      if (
        error instanceof Error &&
        error.message === 'EVENT_MEDIA_REFRESH_REQUIRED'
      ) {
        setOperation({ phase: 'refresh_required', slot });
        return;
      }
      if (
        error instanceof ApiError &&
        error.code === 'EVENT_VERSION_CONFLICT'
      ) {
        await refreshAfterConflict(() =>
          refreshEvent(undefined, controller.signal),
        );
      }
      if (controller.signal.aborted) return;
      setOperation({ message: mediaErrorMessage(error), phase: 'error', slot });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      busyRef.current = false;
      if (previewUrlRef.current === previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrlRef.current = null;
        if (mountedRef.current) setPreview(null);
      }
    }
  }

  async function remove(slot: EventMediaSlot): Promise<void> {
    if (busyRef.current || operation.phase !== 'idle') return;
    busyRef.current = true;
    setOperation({ phase: 'removing', slot });
    try {
      const eventVersion = await removeEventMedia({
        eventId: event.eventId,
        expectedVersion: event.version,
        slot,
      });
      queryClient.setQueryData<AdminEvent>(
        adminEventQueryKey(event.eventId),
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                media: current.media.filter((item) => item.slot !== slot),
                version: eventVersion,
              },
      );
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: adminEventQueryKey(event.eventId),
      });
      void queryClient.invalidateQueries({ queryKey: adminEventListQueryKey });
      setOperation({ phase: 'idle' });
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        error.code === 'EVENT_VERSION_CONFLICT'
      ) {
        await refreshAfterConflict(refreshEvent);
      }
      setOperation({ message: mediaErrorMessage(error), phase: 'error', slot });
    } finally {
      busyRef.current = false;
    }
  }

  function clearError() {
    if (operation.phase === 'error') setOperation({ phase: 'idle' });
  }

  return { chooseFile, clearError, operation, preview, remove };
}

async function refreshAfterConflict(
  refreshEvent: () => Promise<AdminEvent>,
): Promise<void> {
  try {
    await refreshEvent();
  } catch {
    // The original conflict remains the useful recovery message.
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function mediaErrorMessage(error: unknown): string {
  if (error instanceof EventMediaVerificationTimedOutError) {
    return 'Image verification is taking too long. Try again.';
  }
  if (error instanceof Error) {
    if (error.message === 'EVENT_MEDIA_VERSION_CONFLICT') {
      return 'The event changed while this image was uploading. Choose the image again.';
    }
    if (error.message === 'EVENT_MEDIA_UPLOAD_EXPIRED') {
      return 'The upload expired before it could finish. Choose the image again.';
    }
    if (error.message === 'EVENT_MEDIA_UPLOAD_REJECTED') {
      return 'This image could not be used. Choose another image.';
    }
    if (error.message === 'EVENT_MEDIA_STORAGE_UPLOAD_FAILED') {
      return 'The image could not be uploaded. Try again.';
    }
  }
  if (error instanceof ApiError && error.code === 'EVENT_VERSION_CONFLICT') {
    return 'The event changed. Its latest images are now shown; try again.';
  }
  if (
    error instanceof ApiError &&
    error.code === 'EVENT_MEDIA_UPLOAD_IN_PROGRESS'
  ) {
    return 'This image is still being processed. Try again shortly.';
  }
  return userFacingApiError(error);
}
