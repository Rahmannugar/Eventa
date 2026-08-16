import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  ApiError,
  isSessionInvalid,
  userFacingApiError,
} from '../../lib/api/api-error';
import {
  draftEventFormValues,
  validateDraftEventForm,
  type DraftEventFormErrors,
  type DraftEventFormValues,
} from '../../lib/events/event.validation';
import type { AdminEvent } from '../../lib/events/event.types';
import { useAdminEvent, useUpdateDraftEvent } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { EventFormFields } from './EventFormFields';

const eventIdSchema = z.uuid();

export function EventEditor({ eventId }: { eventId: string }) {
  const location = useLocation();
  const validEventId = eventIdSchema.safeParse(eventId).success;
  const eventQuery = useAdminEvent(eventId, validEventId);

  if (!validEventId) return <EventState title="This event link is not valid" />;
  if (eventQuery.isPending) return <EventEditorLoading />;
  if (eventQuery.error !== null && isSessionInvalid(eventQuery.error)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  if (eventQuery.error !== null && eventQuery.data === undefined) {
    const notFound =
      eventQuery.error instanceof ApiError &&
      eventQuery.error.statusCode === 404;
    return notFound ? (
      <EventState title="Event not found" />
    ) : (
      <EventState
        title="Event could not be loaded"
        retry={() => void eventQuery.refetch()}
      />
    );
  }

  return (
    <main className="admin-page admin-page--editor">
      <header className="event-editor-header">
        <Link
          className="back-link"
          to={`/admin/events/${eventQuery.data.eventId}`}
        >
          <ArrowLeftIcon aria-hidden="true" />
          Event details
        </Link>
        <div className="event-editor-header__title">
          <h1>Edit {eventQuery.data.title}</h1>
          <span
            className={`status-badge status-badge--${eventQuery.data.status}`}
          >
            {eventQuery.data.status === 'draft' ? 'Draft' : 'Published'}
          </span>
        </div>
      </header>

      {eventQuery.data.status === 'published' ? (
        <Navigate replace to={`/admin/events/${eventQuery.data.eventId}`} />
      ) : (
        <DraftEventForm
          key={`${eventQuery.data.eventId}:${String(eventQuery.data.version)}`}
          event={eventQuery.data}
          reload={async () => {
            const result = await eventQuery.refetch();
            if (result.error !== null) throw result.error;
          }}
        />
      )}
    </main>
  );
}

function DraftEventForm({
  event,
  reload,
}: {
  event: AdminEvent;
  reload: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const update = useUpdateDraftEvent();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => draftEventFormValues(event));
  const [errors, setErrors] = useState<DraftEventFormErrors>({});
  const [reloadError, setReloadError] = useState(false);
  const [reloading, setReloading] = useState(false);
  const dirty =
    JSON.stringify(values) !== JSON.stringify(draftEventFormValues(event));
  const conflict =
    update.error instanceof ApiError &&
    update.error.code === 'EVENT_VERSION_CONFLICT';

  function change<K extends keyof DraftEventFormValues>(
    field: K,
    value: DraftEventFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field] !== undefined)
      setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function focusFirstInvalidField() {
    window.setTimeout(() => {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }, 0);
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const result = validateDraftEventForm(values, event.version);
    if (!result.success) {
      setErrors(result.errors);
      focusFirstInvalidField();
      return;
    }

    setErrors({});
    update.reset();
    try {
      const saved = await update.mutateAsync({
        eventId: event.eventId,
        input: result.data,
      });
      toast.success('Changes saved.');
      void navigate(`/admin/events/${saved.eventId}`);
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.length > 0) {
        const serverErrors: DraftEventFormErrors = {};
        for (const fieldError of error.fieldErrors) {
          const rawField = fieldError.field.split('.').at(-1);
          const field = rawField === 'name' ? 'venueName' : rawField;
          if (field !== undefined && field in values) {
            serverErrors[field as keyof DraftEventFormValues] =
              fieldError.message;
          }
        }
        setErrors(serverErrors);
        focusFirstInvalidField();
        return;
      }
      if (
        !(error instanceof ApiError) ||
        error.code !== 'EVENT_VERSION_CONFLICT'
      ) {
        toast.error('Changes not saved.', {
          description: userFacingApiError(error),
        });
      }
    }
  }

  return (
    <form
      ref={formRef}
      className="event-form event-form--single-column"
      noValidate
      onSubmit={(formEvent) => void submit(formEvent)}
    >
      {update.error === null ? null : conflict ? (
        <div className="conflict-notice" role="alert">
          <WarningCircleIcon aria-hidden="true" weight="fill" />
          <div>
            <strong>This event changed since you opened it</strong>
            <p>Load the latest event, review your changes, then save again.</p>
            {reloadError ? (
              <p role="status">
                The latest event could not be loaded. Try again.
              </p>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              busy={reloading}
              onClick={() => {
                setReloadError(false);
                setReloading(true);
                void reload()
                  .catch(() => setReloadError(true))
                  .finally(() => setReloading(false));
              }}
            >
              <ArrowsClockwiseIcon aria-hidden="true" />
              {reloading ? 'Loading…' : 'Load latest event'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="form-alert" role="alert">
          <strong>Changes not saved.</strong>
          <span>{userFacingApiError(update.error)}</span>
        </div>
      )}

      <EventFormFields
        idPrefix="edit-event"
        values={values}
        errors={errors}
        onChange={change}
      />

      <footer className="event-form__actions event-form__actions--end">
        <Link
          className="button button--secondary"
          to={`/admin/events/${event.eventId}`}
        >
          Cancel
        </Link>
        <Button type="submit" busy={update.isPending} disabled={!dirty}>
          {update.isPending ? 'Saving changes…' : 'Save changes'}
        </Button>
      </footer>
    </form>
  );
}

function EventEditorLoading() {
  return (
    <main className="admin-page" aria-busy="true" aria-label="Loading event">
      <div className="event-loading__heading" />
      <div className="event-loading__panel" />
      <span className="visually-hidden">Loading event…</span>
    </main>
  );
}

function EventState({ title, retry }: { title: string; retry?: () => void }) {
  return (
    <main className="admin-page">
      <div
        className="event-page-state"
        role={retry === undefined ? undefined : 'alert'}
      >
        <WarningCircleIcon aria-hidden="true" />
        <h1>{title}</h1>
        <div>
          <Link className="button button--secondary" to="/admin">
            Back to Events
          </Link>
          {retry === undefined ? null : (
            <Button type="button" onClick={retry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
