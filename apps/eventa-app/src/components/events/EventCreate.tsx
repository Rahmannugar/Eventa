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
import { adminPage, backLink, formAlert, secondaryLink } from './adminStyles';

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
    <main className={`${adminPage} max-w-[90rem] pt-[clamp(1.5rem,4vw,3rem)]`}>
      <header>
        <Link className={backLink} to="/admin">
          <ArrowLeftIcon aria-hidden="true" />
          Events
        </Link>
        <div className="flex items-end justify-between gap-4 border-b border-[var(--line)] pb-6 max-[560px]:flex-col max-[560px]:items-start">
          <h1 className="font-[var(--serif)] text-[clamp(2.25rem,6vw,3.7rem)] font-medium leading-none tracking-[-.055em]">Create event</h1>
        </div>
      </header>

      <form
        ref={formRef}
        className="mx-auto mt-[clamp(1.5rem,4vw,2.75rem)] grid w-full max-w-[56rem] gap-5"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {create.error === null ? null : (
          <div className={`${formAlert} grid gap-1`} role="alert">
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

        <footer className="sticky bottom-0 z-[8] flex items-center justify-end gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-3 shadow-[0_-8px_28px_rgb(23_35_29_/_7%)] backdrop-blur-sm">
          <Link className={secondaryLink} to="/admin">
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
