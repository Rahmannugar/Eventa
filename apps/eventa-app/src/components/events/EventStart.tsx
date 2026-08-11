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
  .min(1, 'Enter a working title for the event.')
  .max(160, 'Event title must not exceed 160 characters.');

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
      toast.success('Draft created.', {
        description: 'Add the event schedule and venue next.',
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
          <p className="eyebrow">Event management</p>
          <h1>Events</h1>
          <p>Create a draft, then shape the details guests will rely on.</p>
        </div>
      </header>

      <section className="event-start" aria-labelledby="create-event-title">
        <div className="event-start__icon" aria-hidden="true">
          <CalendarPlusIcon weight="duotone" />
        </div>
        <div className="event-start__copy">
          <h2 id="create-event-title">Create your next event</h2>
          <p>
            Begin with a working title. Your draft stays private while you add
            its schedule and venue.
          </p>
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
              <strong>Draft not created.</strong>
              <span>{userFacingApiError(createDraft.error)}</span>
            </div>
          )}

          <TextField
            id="event-title"
            label="Working title"
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
            {createDraft.isPending ? 'Creating draft…' : 'Create draft'}
            {createDraft.isPending ? null : (
              <ArrowRightIcon aria-hidden="true" />
            )}
          </Button>
        </form>
      </section>

      <aside className="event-start__note">
        <strong>Returning to a draft?</strong>
        <span>
          Open its saved Eventa URL to continue from the latest authoritative
          version.
        </span>
      </aside>
    </main>
  );
}
