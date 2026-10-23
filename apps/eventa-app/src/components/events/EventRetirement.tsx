import { TrashIcon, XIcon } from '@phosphor-icons/react';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  ApiError,
  isSessionInvalid,
  userFacingApiError,
} from '../../lib/api/api-error';
import type { AdminEvent } from '../../lib/events/event.types';
import { useRetireDraftEvent } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { confirmationDialog, dialogActions, dialogBackdrop, dialogClose, formAlert } from './adminStyles';

export function EventRetirement({
  disabled,
  event,
  onOperationChange,
  reload,
}: {
  disabled: boolean;
  event: AdminEvent;
  onOperationChange: Dispatch<SetStateAction<boolean>>;
  reload: () => Promise<AdminEvent>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const retirement = useRetireDraftEvent();
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const retirementPendingRef = useRef(false);
  const reloadingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const needsLatestEvent =
    retirement.error instanceof ApiError &&
    (retirement.error.code === 'EVENT_VERSION_CONFLICT' ||
      retirement.error.code === 'EVENT_RETIREMENT_NOT_ALLOWED');

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

  if (retirement.error !== null && isSessionInvalid(retirement.error)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  function close() {
    if (retirementPendingRef.current || reloadingRef.current) return;
    setOpen(false);
    setReloadFailed(false);
    retirement.reset();
  }

  async function retire() {
    retirement.reset();
    retirementPendingRef.current = true;
    onOperationChange(true);
    try {
      await retirement.mutateAsync({
        eventId: event.eventId,
        expectedVersion: event.version,
      });
      toast.success('Draft removed.');
      void navigate('/admin', { replace: true });
    } catch {
      // The dialog owns recoverable retirement failures.
    } finally {
      retirementPendingRef.current = false;
      onOperationChange(false);
    }
  }

  async function loadLatest() {
    setReloadFailed(false);
    setReloading(true);
    reloadingRef.current = true;
    try {
      const latest = await reload();
      retirement.reset();
      if (latest.status === 'published') setOpen(false);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.statusCode === 404) {
        toast.info('This draft has already been removed.');
        void navigate('/admin', { replace: true });
      } else {
        setReloadFailed(true);
      }
    } finally {
      reloadingRef.current = false;
      setReloading(false);
    }
  }

  return (
    <section className="grid gap-4 rounded-2xl border border-[var(--danger)]/25 bg-[var(--paper)] p-5" aria-labelledby="retirement-title">
      <div className="flex items-start gap-3">
        <TrashIcon aria-hidden="true" className="size-5 shrink-0 text-[var(--danger)]" />
        <div>
          <h2 className="font-[family-name:var(--serif)] text-lg font-medium" id="retirement-title">Remove draft</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">Remove this event from your Events list.</p>
        </div>
      </div>
      <Button
        ref={triggerRef}
        type="button"
        variant="quiet"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Remove event
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
            aria-labelledby="retire-dialog-title"
            aria-describedby="retire-dialog-description"
            onKeyDown={(keyboardEvent) => {
              if (
                keyboardEvent.key === 'Escape' &&
                !retirementPendingRef.current &&
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
              aria-label="Close event removal confirmation"
              disabled={retirement.isPending || reloading}
              onClick={close}
            >
              <XIcon aria-hidden="true" />
            </button>
            <h2 className="pr-8 font-[family-name:var(--serif)] text-2xl font-medium" id="retire-dialog-title">Remove this draft?</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]" id="retire-dialog-description">
              {event.title} will disappear from your Events list. Its
              information is kept so it can be recovered later.
            </p>

            {retirement.error === null ? null : needsLatestEvent ? (
              <div className={`${formAlert} mt-4 grid gap-2`} role="alert">
                <strong>The event changed before it could be removed.</strong>
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
                  disabled={retirement.isPending}
                  onClick={() => void loadLatest()}
                >
                  {reloading ? 'Loading…' : 'Load latest details'}
                </Button>
              </div>
            ) : (
              <div className={`${formAlert} mt-4`} role="alert">
                {userFacingApiError(retirement.error)}
              </div>
            )}

            <div className={`${dialogActions} mt-6`}>
              <Button
                type="button"
                variant="secondary"
                disabled={retirement.isPending || reloading}
                onClick={close}
              >
                Keep event
              </Button>
              <Button
                type="button"
                variant="danger"
                busy={retirement.isPending}
                disabled={reloading || needsLatestEvent}
                onClick={() => void retire()}
              >
                {retirement.isPending ? 'Removing…' : 'Remove draft'}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
