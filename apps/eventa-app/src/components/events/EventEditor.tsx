import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  MapPinIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type TextareaHTMLAttributes,
} from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
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
import { TextField } from '../ui/TextField';

const eventIdSchema = z.uuid();

export function EventEditor({ eventId }: { eventId: string }) {
  const location = useLocation();
  const validEventId = eventIdSchema.safeParse(eventId).success;
  const eventQuery = useAdminEvent(eventId, validEventId);
  const [savedMessage, setSavedMessage] = useState<string>();

  if (!validEventId) {
    return (
      <EventState
        title="This event link is not valid"
        description="Return to Events and create a new draft, or use the complete link for an existing event."
      />
    );
  }

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
    return (
      <EventState
        title={notFound ? 'Event not found' : 'Event could not be loaded'}
        description={
          notFound
            ? 'It may have been removed, or this link may be incomplete.'
            : 'Your draft is unchanged. Check your connection and try again.'
        }
        retry={notFound ? undefined : eventQuery.refetch}
      />
    );
  }

  return (
    <main className="admin-page admin-page--editor">
      <header className="event-editor-header">
        <div>
          <Link className="back-link" to="/admin">
            <ArrowLeftIcon aria-hidden="true" />
            Events
          </Link>
          <div className="event-editor-header__title">
            <div>
              <h1>{eventQuery.data.title}</h1>
              <p>
                {eventQuery.data.status === 'draft'
                  ? 'Private draft'
                  : 'Published event'}{' '}
                · Version {eventQuery.data.version}
              </p>
            </div>
            <span
              className={`status-badge status-badge--${eventQuery.data.status}`}
            >
              {eventQuery.data.status}
            </span>
          </div>
        </div>
      </header>

      <div className="event-editor-layout">
        <div>
          {savedMessage === undefined ? null : (
            <div className="form-status event-editor-status" role="status">
              {savedMessage}
            </div>
          )}

          {eventQuery.data.status === 'published' ? (
            <div className="event-locked" role="status">
              <WarningCircleIcon aria-hidden="true" weight="fill" />
              <div>
                <h2>This event is published</h2>
                <p>
                  Published event details are locked. Draft editing is no longer
                  available for this event.
                </p>
              </div>
            </div>
          ) : (
            <DraftEventForm
              key={`${eventQuery.data.eventId}:${String(eventQuery.data.version)}`}
              event={eventQuery.data}
              reload={async () => {
                const result = await eventQuery.refetch();
                if (result.error !== null) throw result.error;
              }}
              onSaved={(version) => {
                setSavedMessage(`Changes saved as version ${String(version)}.`);
              }}
            />
          )}
        </div>

        <aside
          className="event-editor-guide"
          aria-labelledby="draft-guide-title"
        >
          <p className="eyebrow">Draft guide</p>
          <h2 id="draft-guide-title">What this draft needs</h2>
          <ul>
            <li>
              <div>
                <strong>Guest-facing details</strong>
                <small>Use a clear title, description, and category.</small>
              </div>
            </li>
            <li>
              <div>
                <strong>Local schedule</strong>
                <small>Choose the times in the event’s IANA timezone.</small>
              </div>
            </li>
            <li>
              <div>
                <strong>Recognizable venue</strong>
                <small>Include a complete address and country code.</small>
              </div>
            </li>
          </ul>
        </aside>
      </div>
    </main>
  );
}

function DraftEventForm({
  event,
  reload,
  onSaved,
}: {
  event: AdminEvent;
  reload: () => Promise<unknown>;
  onSaved: Dispatch<number>;
}) {
  const update = useUpdateDraftEvent();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => draftEventFormValues(event));
  const [errors, setErrors] = useState<DraftEventFormErrors>({});
  const [reloadError, setReloadError] = useState(false);
  const [reloading, setReloading] = useState(false);
  const initialValues = draftEventFormValues(event);
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  const conflict =
    update.error instanceof ApiError &&
    update.error.code === 'EVENT_VERSION_CONFLICT';

  useEffect(() => {
    if (!dirty) return;
    const preventAccidentalExit = (browserEvent: BeforeUnloadEvent) => {
      browserEvent.preventDefault();
    };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => {
      window.removeEventListener('beforeunload', preventAccidentalExit);
    };
  }, [dirty]);

  function focusFirstInvalidField() {
    window.setTimeout(() => {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }, 0);
  }

  function change<K extends keyof DraftEventFormValues>(
    field: K,
    value: DraftEventFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field] !== undefined) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
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
      onSaved(saved.version);
      toast.success('Event details saved.');
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
      }
    }
  }

  return (
    <form
      ref={formRef}
      className="event-form"
      noValidate
      onSubmit={(formEvent) => {
        void submit(formEvent);
      }}
    >
      {update.error === null ? null : conflict ? (
        <div className="conflict-notice" role="alert">
          <WarningCircleIcon aria-hidden="true" weight="fill" />
          <div>
            <strong>A newer version is available</strong>
            <p>
              Your entered values are still here. Reload the saved event before
              applying your changes again.
            </p>
            {reloadError ? (
              <p role="status">
                The latest version could not be loaded. Your entered values are
                still here; check your connection and try again.
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
                  .catch(() => {
                    setReloadError(true);
                  })
                  .finally(() => {
                    setReloading(false);
                  });
              }}
            >
              <ArrowsClockwiseIcon aria-hidden="true" />
              {reloading ? 'Reloading event…' : 'Reload saved event'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="form-alert" role="alert">
          <strong>Changes not saved.</strong>
          <span>{userFacingApiError(update.error)}</span>
        </div>
      )}

      <section
        className="event-form__section"
        aria-labelledby="event-details-title"
      >
        <div className="event-form__section-heading">
          <CalendarBlankIcon aria-hidden="true" />
          <div>
            <h2 id="event-details-title">Event details</h2>
            <p>Describe what guests can expect and when it takes place.</p>
          </div>
        </div>

        <div className="event-form__fields">
          <TextField
            id="draft-title"
            label="Event title"
            maxLength={160}
            value={values.title}
            error={errors.title}
            onChange={(input) => change('title', input.target.value)}
          />
          <TextAreaField
            id="draft-description"
            label="Description"
            maxLength={10_000}
            rows={7}
            value={values.description}
            error={errors.description}
            onChange={(input) => change('description', input.target.value)}
          />
          <TextField
            id="draft-category"
            label="Category"
            maxLength={80}
            placeholder="Design"
            value={values.category}
            error={errors.category}
            onChange={(input) => change('category', input.target.value)}
          />
          <div className="event-form__grid">
            <TextField
              id="draft-start"
              label="Starts"
              type="datetime-local"
              value={values.startsAt}
              error={errors.startsAt}
              onChange={(input) => change('startsAt', input.target.value)}
            />
            <TextField
              id="draft-end"
              label="Ends"
              type="datetime-local"
              value={values.endsAt}
              error={errors.endsAt}
              onChange={(input) => change('endsAt', input.target.value)}
            />
          </div>
          <TextField
            id="draft-timezone"
            label="Timezone"
            maxLength={64}
            placeholder="Africa/Lagos"
            value={values.timeZone}
            error={errors.timeZone}
            onChange={(input) => change('timeZone', input.target.value)}
          />
        </div>
      </section>

      <section className="event-form__section" aria-labelledby="venue-title">
        <div className="event-form__section-heading">
          <MapPinIcon aria-hidden="true" />
          <div>
            <h2 id="venue-title">Venue</h2>
            <p>Give guests a complete, recognizable destination.</p>
          </div>
        </div>

        <div className="event-form__fields">
          <TextField
            id="venue-name"
            label="Venue name"
            maxLength={160}
            autoComplete="organization"
            value={values.venueName}
            error={errors.venueName}
            onChange={(input) => change('venueName', input.target.value)}
          />
          <TextField
            id="venue-address-one"
            label="Address line 1"
            maxLength={200}
            autoComplete="address-line1"
            value={values.addressLine1}
            error={errors.addressLine1}
            onChange={(input) => change('addressLine1', input.target.value)}
          />
          <TextField
            id="venue-address-two"
            label="Address line 2 (optional)"
            maxLength={200}
            autoComplete="address-line2"
            value={values.addressLine2}
            error={errors.addressLine2}
            onChange={(input) => change('addressLine2', input.target.value)}
          />
          <div className="event-form__grid event-form__grid--address">
            <TextField
              id="venue-city"
              label="City"
              maxLength={120}
              autoComplete="address-level2"
              value={values.city}
              error={errors.city}
              onChange={(input) => change('city', input.target.value)}
            />
            <TextField
              id="venue-region"
              label="State or region (optional)"
              maxLength={120}
              autoComplete="address-level1"
              value={values.region}
              error={errors.region}
              onChange={(input) => change('region', input.target.value)}
            />
            <TextField
              id="venue-postal-code"
              label="Postal code (optional)"
              maxLength={32}
              autoComplete="postal-code"
              value={values.postalCode}
              error={errors.postalCode}
              onChange={(input) => change('postalCode', input.target.value)}
            />
            <TextField
              id="venue-country"
              label="Country code"
              maxLength={2}
              autoComplete="country"
              placeholder="NG"
              value={values.countryCode}
              error={errors.countryCode}
              onChange={(input) =>
                change('countryCode', input.target.value.toUpperCase())
              }
            />
          </div>
        </div>
      </section>

      <footer className="event-form__actions">
        <p aria-live="polite">
          {dirty
            ? 'You have unsaved changes.'
            : 'All visible changes are saved.'}
        </p>
        <Button type="submit" busy={update.isPending} disabled={!dirty}>
          {update.isPending ? 'Saving changes…' : 'Save changes'}
        </Button>
      </footer>
    </form>
  );
}

function TextAreaField({
  error,
  id,
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string | undefined;
  label: string;
}) {
  const errorId = `${String(id)}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        {...props}
        id={id}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
      />
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

function EventEditorLoading() {
  return (
    <main className="admin-page" aria-busy="true" aria-label="Loading event">
      <div className="event-loading__heading" />
      <div className="event-loading__layout">
        <div className="event-loading__panel" />
        <div className="event-loading__aside" />
      </div>
      <span className="visually-hidden">Loading event…</span>
    </main>
  );
}

function EventState({
  title,
  description,
  retry,
}: {
  title: string;
  description: string;
  retry?: (() => Promise<unknown>) | undefined;
}) {
  return (
    <main className="admin-page">
      <div
        className="event-page-state"
        role={retry === undefined ? undefined : 'alert'}
      >
        <WarningCircleIcon aria-hidden="true" weight="duotone" />
        <h1>{title}</h1>
        <p>{description}</p>
        <div>
          {retry === undefined ? null : (
            <Button
              onClick={() => {
                void retry();
              }}
            >
              Try again
            </Button>
          )}
          <Link className="button button--secondary" to="/admin">
            Back to Events
          </Link>
        </div>
      </div>
    </main>
  );
}
