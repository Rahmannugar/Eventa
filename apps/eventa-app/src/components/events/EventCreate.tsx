import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { isSessionInvalid, userFacingApiError } from '../../lib/api/api-error';
import {
  emptyEventFormValues,
  validateCreateEventForm,
  type DraftEventFormErrors,
  type DraftEventFormValues,
} from '../../lib/events/event.validation';
import { useCreateEvent } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { EventFormFields } from './EventFormFields';

export function EventCreate() {
  const navigate = useNavigate();
  const location = useLocation();
  const create = useCreateEvent();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(emptyEventFormValues);
  const [errors, setErrors] = useState<DraftEventFormErrors>({});

  if (create.error !== null && isSessionInvalid(create.error)) {
    return (
      <Navigate replace to="/admin/login" state={{ from: location.pathname }} />
    );
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

  function focusFirstInvalidField() {
    window.setTimeout(() => {
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }, 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateCreateEventForm(values);
    if (!result.success) {
      setErrors(result.errors);
      focusFirstInvalidField();
      return;
    }

    setErrors({});
    create.reset();
    try {
      const created = await create.mutateAsync(result.data);
      toast.success('Event created.');
      void navigate(`/admin/events/${created.eventId}`);
    } catch (error) {
      toast.error('Event not created.', {
        description: userFacingApiError(error),
      });
    }
  }

  return (
    <main className="admin-page admin-page--editor">
      <header className="event-editor-header">
        <Link className="back-link" to="/admin">
          <ArrowLeftIcon aria-hidden="true" />
          Events
        </Link>
        <div className="event-editor-header__title">
          <h1>Create event</h1>
        </div>
      </header>

      <form
        ref={formRef}
        className="event-form event-form--single-column"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {create.error === null ? null : (
          <div className="form-alert" role="alert">
            <strong>Event not created.</strong>
            <span>{userFacingApiError(create.error)}</span>
          </div>
        )}

        <EventFormFields
          idPrefix="create-event"
          values={values}
          errors={errors}
          onChange={change}
        />

        <footer className="event-form__actions event-form__actions--end">
          <Link className="button button--secondary" to="/admin">
            Cancel
          </Link>
          <Button type="submit" busy={create.isPending}>
            {create.isPending ? 'Creating event…' : 'Create event'}
          </Button>
        </footer>
      </form>
    </main>
  );
}
