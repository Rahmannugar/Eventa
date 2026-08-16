import { ArrowRightIcon, CalendarPlusIcon } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { userFacingApiError } from '../../lib/api/api-error';
import { useCreateDraftEvent } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

const draftTitleSchema = z
  .string()
  .trim()
  .min(1, 'Enter an event name.')
  .max(160, 'Event name must not exceed 160 characters.');

export function EventStart() {
  const navigate = useNavigate();
  const createDraft = useCreateDraftEvent();
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = draftTitleSchema.safeParse(title);
    if (!result.success) {
      setTitleError(result.error.issues[0]?.message);
      return;
    }

    setTitleError(undefined);
    createDraft.reset();
    try {
      const created = await createDraft.mutateAsync({ title: result.data });
      toast.success('Event created.', {
        description: 'Now add the date and venue.',
      });
      void navigate(`/admin/events/${created.eventId}`);
    } catch {
      // The mutation error remains in the form for explicit recovery.
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-page__header">
        <div>
          <h1>Events</h1>
        </div>
      </header>

      <section className="event-start" aria-labelledby="create-event-title">
        <div className="event-start__icon" aria-hidden="true">
          <CalendarPlusIcon weight="duotone" />
        </div>
        <div className="event-start__copy">
          <h2 id="create-event-title">New event</h2>
          <p>Start with the event name. You can add the date and venue next.</p>
        </div>

        <form
          className="event-start__form"
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          {createDraft.error === null ? null : (
            <div className="form-alert" role="alert">
              <strong>Event not created.</strong>
              <span>{userFacingApiError(createDraft.error)}</span>
            </div>
          )}

          <TextField
            id="event-title"
            label="Event name"
            autoComplete="off"
            maxLength={160}
            placeholder="Lagos Design Week"
            value={title}
            error={titleError}
            onChange={(event) => {
              setTitle(event.target.value);
              if (titleError !== undefined) setTitleError(undefined);
            }}
          />

          <Button type="submit" busy={createDraft.isPending}>
            {createDraft.isPending ? 'Creating event…' : 'Create event'}
            {createDraft.isPending ? null : (
              <ArrowRightIcon aria-hidden="true" />
            )}
          </Button>
        </form>
      </section>
    </main>
  );
}
