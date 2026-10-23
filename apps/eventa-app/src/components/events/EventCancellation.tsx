import { WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import {
  ApiError,
  isSessionInvalid,
  userFacingApiError,
} from '../../lib/api/api-error';
import type { AdminEvent } from '../../lib/events/event.types';
import { useCancelEvent } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { confirmationDialog, dialogActions, dialogBackdrop, dialogClose, formAlert } from './adminStyles';

export function EventCancellation({
  event,
  mediaBusy,
  onOperationChange,
  reload,
}: {
  event: AdminEvent;
  mediaBusy: boolean;
  onOperationChange: Dispatch<SetStateAction<boolean>>;
  reload: () => Promise<AdminEvent>;
}) {
  const location = useLocation();
  const cancellation = useCancelEvent();
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const cancelPendingRef = useRef(false);
  const reloadingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const versionConflict =
    cancellation.error instanceof ApiError &&
    cancellation.error.code === 'EVENT_VERSION_CONFLICT';
  const needsLatestEvent = versionConflict;

  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function keepFocusInside(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);

      if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault();
        last?.focus();
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', keepFocusInside);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keepFocusInside);
      if (trigger?.isConnected === true) trigger.focus();
    };
  }, [open]);

  if (cancellation.error !== null && isSessionInvalid(cancellation.error)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  function close() {
    if (cancelPendingRef.current || reloadingRef.current) return;
    setOpen(false);
    setReloadFailed(false);
    cancellation.reset();
  }

  async function cancel() {
    cancellation.reset();
    cancelPendingRef.current = true;
    onOperationChange(true);
    try {
      await cancellation.mutateAsync({
        eventId: event.eventId,
        expectedVersion: event.version,
      });
      toast.success('Event cancelled.');
      setOpen(false);
    } catch {
      // The dialog owns recoverable cancellation failures.
    } finally {
      cancelPendingRef.current = false;
      onOperationChange(false);
    }
  }

  async function loadLatest() {
    setReloadFailed(false);
    setReloading(true);
    reloadingRef.current = true;
    try {
      const latest = await reload();
      if (versionConflict) cancellation.reset();
      if (latest.status !== 'published') {
        setOpen(false);
      }
    } catch {
      setReloadFailed(true);
    } finally {
      reloadingRef.current = false;
      setReloading(false);
    }
  }

  if (event.status !== 'published') return null;

  return (
    <section
      className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
      aria-labelledby="cancellation-title"
    >
      <div className="flex items-start gap-3">
        <WarningCircleIcon aria-hidden="true" className="size-5 shrink-0 text-[var(--evergreen)]" weight="fill" />
        <div>
          <h2 className="text-xs font-semibold" id="cancellation-title">Cancellation</h2>
          <strong className="mt-1 block font-[family-name:var(--serif)] text-xl font-medium tracking-tight">Stop sales and revoke issued tickets</strong>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Cancelling stops new holds, releases active holds, and tells ticketing
        to revoke issued tickets.
      </p>
      <Button
        ref={triggerRef}
        type="button"
        disabled={mediaBusy}
        onClick={() => setOpen(true)}
      >
        Review and cancel
      </Button>

      {open ? (
        <div
          className={dialogBackdrop}
          onMouseDown={(mouseEvent) => {
            if (mouseEvent.target === mouseEvent.currentTarget) close();
          }}
        >
          <section
            ref={dialogRef}
            className={confirmationDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-dialog-title"
            aria-describedby="cancel-dialog-description"
            onKeyDown={(keyboardEvent) => {
              if (
                keyboardEvent.key === 'Escape' &&
                !cancelPendingRef.current &&
                !reloadingRef.current
              ) {
                close();
              }
            }}
          >
            <button
              ref={closeButtonRef}
              type="button"
              className={dialogClose}
              aria-label="Close cancellation review"
              disabled={cancellation.isPending || reloading}
              onClick={close}
            >
              <XIcon aria-hidden="true" />
            </button>
            <h2 className="pr-8 font-[family-name:var(--serif)] text-2xl font-medium" id="cancel-dialog-title">Cancel this event?</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]" id="cancel-dialog-description">
              {event.title} will stop selling tickets. Active holds are released
              and issued tickets are prepared for revocation.
            </p>

            {cancellation.error === null ? null : needsLatestEvent ? (
              <div className={`${formAlert} mt-4 grid gap-2`} role="alert">
                <strong>The event changed before it could be cancelled.</strong>
                <span>
                  Load the latest details, review them, then try again.
                </span>
                {reloadFailed ? (
                  <span>
                    The latest details could not be loaded. Try again.
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  busy={reloading}
                  disabled={cancellation.isPending}
                  onClick={() => void loadLatest()}
                >
                  {reloading ? 'Loading…' : 'Load latest details'}
                </Button>
              </div>
            ) : (
              <div className={`${formAlert} mt-4`} role="alert">
                {userFacingApiError(cancellation.error)}
              </div>
            )}

            <div className={`${dialogActions} mt-6`}>
              <Button
                type="button"
                variant="secondary"
                disabled={cancellation.isPending || reloading}
                onClick={close}
              >
                Close
              </Button>
              <Button
                type="button"
                busy={cancellation.isPending}
                disabled={reloading || needsLatestEvent}
                onClick={() => void cancel()}
              >
                {cancellation.isPending ? 'Cancelling…' : 'Cancel event'}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
