import {
  ArrowClockwiseIcon,
  ImageIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import {
  useEffect,
  useState,
  type ChangeEvent,
  type ChangeEventHandler,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type {
  AdminEvent,
  AdminEventMedia,
  EventMediaSlot,
} from '../../lib/events/event.types';
import { useEventMedia } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';

const slots: ReadonlyArray<{ label: string; slot: EventMediaSlot }> = [
  { label: 'Cover', slot: 'cover' },
  { label: 'Gallery 1', slot: 'gallery_1' },
  { label: 'Gallery 2', slot: 'gallery_2' },
  { label: 'Gallery 3', slot: 'gallery_3' },
  { label: 'Gallery 4', slot: 'gallery_4' },
];

export function EventMediaManager({
  disabled = false,
  event,
  onOperationChange,
}: {
  disabled?: boolean;
  event: AdminEvent;
  onOperationChange: Dispatch<SetStateAction<boolean>>;
}) {
  const media = useEventMedia(event);
  const [confirmingRemoval, setConfirmingRemoval] =
    useState<EventMediaSlot | null>(null);
  const operationBusy =
    media.operation.phase === 'uploading' ||
    media.operation.phase === 'verifying' ||
    media.operation.phase === 'removing' ||
    media.operation.phase === 'refresh_required';
  const busy = disabled || operationBusy;

  useEffect(() => {
    onOperationChange(operationBusy);
    return () => onOperationChange(false);
  }, [onOperationChange, operationBusy]);

  async function handleFile(
    slot: EventMediaSlot,
    change: ChangeEvent<HTMLInputElement>,
  ) {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (file === undefined || disabled) return;
    await media.chooseFile(slot, file);
  }

  function requestRemoval(slot: EventMediaSlot) {
    if (disabled) return;
    media.clearError();
    setConfirmingRemoval(slot);
  }

  async function confirmRemoval(slot: EventMediaSlot) {
    if (disabled) return;
    setConfirmingRemoval(null);
    await media.remove(slot);
  }

  return (
    <div className="grid gap-3">
      {media.operation.phase === 'error' ? (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-3 text-xs font-semibold text-[var(--danger)]" role="alert">
          <WarningCircleIcon aria-hidden="true" className="size-5 shrink-0" />
          <span className="flex-1">{media.operation.message}</span>
          <Button type="button" variant="quiet" onClick={media.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {media.operation.phase === 'refresh_required' ? (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-3 text-xs font-semibold text-[var(--danger)]" role="status">
          <ArrowClockwiseIcon aria-hidden="true" className="size-5 shrink-0" />
          <span className="flex-1">The image was added. Reload the event to see it.</span>
          <Button
            type="button"
            variant="quiet"
            onClick={() => window.location.reload()}
          >
            Reload event
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 min-[601px]:grid-cols-2">
        {slots.map(({ label, slot }) => {
          const item = event.media.find((candidate) => candidate.slot === slot);
          const active =
            operationBusy &&
            media.operation.phase !== 'idle' &&
            media.operation.slot === slot;
          return (
            <MediaManagerSlot
              key={slot}
              active={active}
              busy={busy}
              confirmingRemoval={confirmingRemoval === slot}
              eventTitle={event.title}
              label={label}
              media={item}
              operation={active ? media.operation : { phase: 'idle' }}
              previewUrl={
                media.preview?.slot === slot ? media.preview.url : undefined
              }
              slot={slot}
              onCancelRemoval={() => setConfirmingRemoval(null)}
              onConfirmRemoval={() => void confirmRemoval(slot)}
              onFile={(change) => void handleFile(slot, change)}
              onRequestRemoval={() => requestRemoval(slot)}
            />
          );
        })}
      </div>
    </div>
  );
}

function MediaManagerSlot({
  active,
  busy,
  confirmingRemoval,
  eventTitle,
  label,
  media,
  onCancelRemoval,
  onConfirmRemoval,
  onFile,
  onRequestRemoval,
  operation,
  previewUrl,
  slot,
}: {
  active: boolean;
  busy: boolean;
  confirmingRemoval: boolean;
  eventTitle: string;
  label: string;
  media?: AdminEventMedia | undefined;
  onCancelRemoval: () => void;
  onConfirmRemoval: () => void;
  onFile: ChangeEventHandler<HTMLInputElement>;
  onRequestRemoval: () => void;
  operation: ReturnType<typeof useEventMedia>['operation'];
  previewUrl?: string | undefined;
  slot: EventMediaSlot;
}) {
  const isCover = slot === 'cover';
  const status = operationStatus(operation);
  const visualUrl = previewUrl ?? media?.url;

  return (
    <article
      className={`min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] ${isCover ? 'min-[601px]:col-span-2' : ''}`.trim()}
      aria-busy={active}
    >
      <div className={`relative overflow-hidden bg-[var(--soft)] ${isCover ? 'aspect-[16/7]' : 'aspect-video'}`}>
        {visualUrl !== undefined ? (
          <img
            src={visualUrl}
            alt={`${eventTitle} ${label.toLowerCase()}${previewUrl === undefined ? '' : ' preview'}`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-[var(--evergreen)]">
            <ImageIcon aria-hidden="true" className="size-6" />
          </div>
        )}
        {status === null ? null : (
          <div className="absolute inset-0 grid content-center justify-items-center gap-2 bg-[#0f2520]/80 text-xs font-bold text-white" role="status">
            {operation.phase === 'uploading' ? (
              <progress className="w-[min(10rem,70%)] accent-[var(--persimmon)]" max="100" value={operation.progress}>
                {operation.progress}%
              </progress>
            ) : (
              <ArrowClockwiseIcon aria-hidden="true" className="size-6" />
            )}
            <span>{status}</span>
          </div>
        )}
      </div>

      <div className="flex min-h-14 flex-col items-start justify-between gap-2 p-3 min-[601px]:flex-row min-[601px]:items-center">
        <strong className="text-xs">{label}</strong>
        {confirmingRemoval ? (
          <div
            className="flex w-full items-center gap-1 min-[601px]:w-auto [&_button]:flex-1 min-[601px]:[&_button]:flex-none"
            role="group"
            aria-label={`Remove ${label}`}
          >
            <Button type="button" variant="quiet" onClick={onCancelRemoval}>
              Keep
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={onConfirmRemoval}
            >
              Remove
            </Button>
          </div>
        ) : (
          <div className="flex w-full items-center gap-1 min-[601px]:w-auto [&_button]:flex-1 min-[601px]:[&_button]:flex-none">
            <label
              className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold text-[var(--muted)] hover:bg-[var(--soft)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] min-[601px]:flex-none ${busy ? 'cursor-not-allowed opacity-55' : ''}`.trim()}
            >
              <UploadSimpleIcon aria-hidden="true" />
              {media === undefined ? 'Add' : 'Replace'}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={onFile}
              />
            </label>
            {media === undefined ? null : (
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                aria-label={`Remove ${label}`}
                onClick={onRequestRemoval}
              >
                <TrashIcon aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function operationStatus(
  operation: ReturnType<typeof useEventMedia>['operation'],
): string | null {
  if (operation.phase === 'uploading')
    return `Uploading ${String(operation.progress)}%`;
  if (operation.phase === 'verifying') return 'Checking image…';
  if (operation.phase === 'removing') return 'Removing…';
  return null;
}
