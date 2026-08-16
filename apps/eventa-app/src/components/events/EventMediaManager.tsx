import {
  ArrowClockwiseIcon,
  ImageIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import {
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
    media.operation.phase !== 'idle' && media.operation.phase !== 'error';
  const busy = disabled || operationBusy;

  async function handleFile(
    slot: EventMediaSlot,
    change: ChangeEvent<HTMLInputElement>,
  ) {
    const file = change.target.files?.[0];
    change.target.value = '';
    if (file === undefined || disabled) return;
    onOperationChange(true);
    try {
      await media.chooseFile(slot, file);
    } finally {
      onOperationChange(false);
    }
  }

  function requestRemoval(slot: EventMediaSlot) {
    if (disabled) return;
    media.clearError();
    setConfirmingRemoval(slot);
  }

  async function confirmRemoval(slot: EventMediaSlot) {
    if (disabled) return;
    setConfirmingRemoval(null);
    onOperationChange(true);
    try {
      await media.remove(slot);
    } finally {
      onOperationChange(false);
    }
  }

  return (
    <div className="event-media-manager">
      {media.operation.phase === 'error' ? (
        <div className="event-media-manager__error" role="alert">
          <WarningCircleIcon aria-hidden="true" />
          <span>{media.operation.message}</span>
          <Button type="button" variant="quiet" onClick={media.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="event-media-manager__slots">
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
              previewUrl={media.preview?.slot === slot ? media.preview.url : undefined}
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
      className={`event-media-slot ${isCover ? 'event-media-slot--cover' : ''}`.trim()}
      aria-busy={active}
    >
      <div className="event-media-slot__visual">
        {visualUrl !== undefined ? (
          <img
            src={visualUrl}
            alt={`${eventTitle} ${label.toLowerCase()}${previewUrl === undefined ? '' : ' preview'}`}
            loading="lazy"
          />
        ) : (
          <div className="event-media-slot__empty">
            <ImageIcon aria-hidden="true" />
          </div>
        )}
        {status === null ? null : (
          <div className="event-media-slot__status" role="status">
            {operation.phase === 'uploading' ? (
              <progress max="100" value={operation.progress}>
                {operation.progress}%
              </progress>
            ) : (
              <ArrowClockwiseIcon aria-hidden="true" />
            )}
            <span>{status}</span>
          </div>
        )}
      </div>

      <div className="event-media-slot__footer">
        <strong>{label}</strong>
        {confirmingRemoval ? (
          <div className="event-media-slot__confirm" role="group" aria-label={`Remove ${label}`}>
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
          <div className="event-media-slot__actions">
            <label
              className={`button button--quiet ${busy ? 'button--disabled' : ''}`.trim()}
            >
              <UploadSimpleIcon aria-hidden="true" />
              {media === undefined ? 'Add' : 'Replace'}
              <input
                className="visually-hidden"
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
  if (operation.phase === 'uploading') return `Uploading ${String(operation.progress)}%`;
  if (operation.phase === 'verifying') return 'Checking image…';
  if (operation.phase === 'removing') return 'Removing…';
  return null;
}
