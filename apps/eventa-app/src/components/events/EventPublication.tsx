import {
  CheckCircleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import {
  ApiError,
  isSessionInvalid,
  userFacingApiError,
} from '../../lib/api/api-error';
import {
  missingEventPublicationRequirements,
  type EventPublicationRequirement,
} from '../../lib/events/event-publication';
import type { AdminEvent } from '../../lib/events/event.types';
import {
  useEventTicketTypes,
  usePublishEvent,
} from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { confirmationDialog, dialogActions, dialogBackdrop, dialogClose, formAlert } from './adminStyles';

const requirementLabels: Record<EventPublicationRequirement, string> = {
  categories: 'At least one category',
  cover: 'A cover image',
  description: 'A description',
  schedule: 'A complete schedule and time zone',
  tickets: 'At least one ticket type',
  venue: 'A venue',
};

export function EventPublication({
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
  const publication = usePublishEvent();
  const ticketTypes = useEventTicketTypes(event.eventId);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const publicationPendingRef = useRef(false);
  const reloadingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const missing = missingEventPublicationRequirements(
    event,
    (ticketTypes.data?.ticketTypes.length ?? 0) > 0,
  );
  const versionConflict =
    publication.error instanceof ApiError &&
    publication.error.code === 'EVENT_VERSION_CONFLICT';
  const publicationIncomplete =
    publication.error instanceof ApiError &&
    publication.error.code === 'EVENT_PUBLICATION_INCOMPLETE';
  const needsLatestEvent = versionConflict || publicationIncomplete;

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

  if (publication.error !== null && isSessionInvalid(publication.error)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  function close() {
    if (publicationPendingRef.current || reloadingRef.current) return;
    setOpen(false);
    setReloadFailed(false);
    publication.reset();
  }

  async function publish() {
    publication.reset();
    publicationPendingRef.current = true;
    onOperationChange(true);
    try {
      await publication.mutateAsync({
        eventId: event.eventId,
        expectedVersion: event.version,
      });
      toast.success('Event published.');
      setOpen(false);
    } catch {
      // The dialog owns recoverable publication failures.
    } finally {
      publicationPendingRef.current = false;
      onOperationChange(false);
    }
  }

  async function loadLatest() {
    setReloadFailed(false);
    setReloading(true);
    reloadingRef.current = true;
    try {
      const latest = await reload();
      const latestTickets = await ticketTypes.refetch();
      const latestMissing = missingEventPublicationRequirements(
        latest,
        (latestTickets.data?.ticketTypes.length ?? 0) > 0,
      );
      if (versionConflict || latestMissing.length > 0) publication.reset();
      if (latest.status === 'published' || latestMissing.length > 0) {
        setOpen(false);
      }
    } catch {
      setReloadFailed(true);
    } finally {
      reloadingRef.current = false;
      setReloading(false);
    }
  }

  return (
    <section
      className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
      aria-labelledby="publication-title"
    >
      <div className="flex items-start gap-3">
        {missing.length === 0 ? (
          <CheckCircleIcon aria-hidden="true" className="size-5 shrink-0 text-[var(--evergreen)]" weight="fill" />
        ) : (
          <WarningCircleIcon aria-hidden="true" className="size-5 shrink-0 text-amber-700" weight="fill" />
        )}
        <div>
          <h2 className="text-xs font-semibold" id="publication-title">Publication</h2>
          <strong className="mt-1 block font-[family-name:var(--serif)] text-xl font-medium tracking-tight">
            {missing.length === 0 ? 'Ready to publish' : 'Not ready to publish'}
          </strong>
        </div>
      </div>

      {missing.length === 0 ? (
        <>
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            {mediaBusy
              ? 'Finish the image change before publishing.'
              : 'Publishing makes the event public and locks its details and images.'}
          </p>
          <Button
            ref={triggerRef}
            type="button"
            disabled={mediaBusy}
            onClick={() => setOpen(true)}
          >
            Review and publish
          </Button>
        </>
      ) : (
        <>
          {ticketTypes.error !== null ? (
            <div className={`${formAlert} grid gap-2`} role="alert">
              <span>Ticket details could not be checked.</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void ticketTypes.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : null}
          <p className="text-xs leading-relaxed text-[var(--muted)]">Add the following before publishing:</p>
          <ul className="grid list-disc gap-2 pl-5 text-xs leading-relaxed text-[var(--ink)]">
            {missing.map((requirement) => (
              <li key={requirement}>{requirementLabels[requirement]}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 max-[560px]:flex-col [&_a]:flex-1">
            {missing.some(
              (requirement) =>
                requirement !== 'cover' && requirement !== 'tickets',
            ) ? (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs font-bold text-[var(--ink)] no-underline hover:bg-[var(--soft)]"
                to={`/admin/events/${event.eventId}/edit`}
              >
                Edit event
              </Link>
            ) : null}
            {missing.includes('cover') ? (
              <a className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs font-bold text-[var(--ink)] no-underline hover:bg-[var(--soft)]" href="#media-title">
                Add cover image
              </a>
            ) : null}
            {missing.includes('tickets') ? (
              <a className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs font-bold text-[var(--ink)] no-underline hover:bg-[var(--soft)]" href="#tickets-title">
                Add ticket type
              </a>
            ) : null}
          </div>
        </>
      )}

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
            aria-labelledby="publish-dialog-title"
            aria-describedby="publish-dialog-description"
            onKeyDown={(keyboardEvent) => {
              if (
                keyboardEvent.key === 'Escape' &&
                !publicationPendingRef.current &&
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
              aria-label="Close publication review"
              disabled={publication.isPending || reloading}
              onClick={close}
            >
              <XIcon aria-hidden="true" />
            </button>
            <h2 className="pr-8 font-[family-name:var(--serif)] text-2xl font-medium" id="publish-dialog-title">Publish this event?</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]" id="publish-dialog-description">
              {event.title} will become public. Its details and images can no
              longer be changed.
            </p>

            {publication.error === null ? null : needsLatestEvent ? (
              <div className={`${formAlert} mt-4 grid gap-2`} role="alert">
                <strong>
                  {publicationIncomplete
                    ? 'This event is not ready to publish.'
                    : 'The event changed before it could be published.'}
                </strong>
                <span>Load the latest details, review them, then try again.</span>
                {reloadFailed ? (
                  <span>The latest details could not be loaded. Try again.</span>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  busy={reloading}
                  disabled={publication.isPending}
                  onClick={() => void loadLatest()}
                >
                  {reloading ? 'Loading…' : 'Load latest details'}
                </Button>
              </div>
            ) : (
              <div className={`${formAlert} mt-4`} role="alert">
                {userFacingApiError(publication.error)}
              </div>
            )}

            <div className={`${dialogActions} mt-6`}>
              <Button
                type="button"
                variant="secondary"
                disabled={publication.isPending || reloading}
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                type="button"
                busy={publication.isPending}
                disabled={reloading || needsLatestEvent}
                onClick={() => void publish()}
              >
                {publication.isPending ? 'Publishing…' : 'Publish event'}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
