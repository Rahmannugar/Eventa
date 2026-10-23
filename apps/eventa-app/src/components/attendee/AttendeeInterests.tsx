import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';

import { userFacingApiError } from '../../lib/api/api-error';
import { apiRequest } from '../../lib/api/api-client';

const interestsSchema = z.object({
  interests: z.array(z.string()),
  updatedAt: z.string().optional(),
});
type Interests = z.infer<typeof interestsSchema>;
const interestsKey = ['attendee', 'interests'] as const;

export function AttendeeInterests() {
  const interests = useQuery({
    queryKey: interestsKey,
    queryFn: ({ signal }) => apiRequest<Interests>('/attendees/me/interests', { responseSchema: interestsSchema, signal }),
    retry: false,
    staleTime: 30_000,
  });

  return (
    <section aria-labelledby="interests-heading" className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 sm:p-6">
      <div><h2 className="font-[family-name:var(--serif)] text-2xl tracking-tight" id="interests-heading">Your interests</h2><p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">Choose what you like to help us find events for you.</p></div>
      {interests.isPending ? <div aria-busy="true" className="mt-6 h-44 animate-pulse rounded-xl bg-[var(--soft)] motion-reduce:animate-none"><span className="sr-only">Loading your interests…</span></div> : interests.isError ? (
        <div className="mt-5 rounded-xl bg-[var(--danger-soft)] p-4" role="alert"><p className="mb-3 text-sm text-[var(--danger)]">We could not load your interests. {userFacingApiError(interests.error)}</p><button className="font-bold text-[var(--evergreen)]" onClick={() => { void interests.refetch(); }} type="button">Try again</button></div>
      ) : <InterestsEditor initial={interests.data} key={interests.data.updatedAt ?? 'unsaved'} />}
    </section>
  );
}

function InterestsEditor({ initial }: { initial: Interests }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial.interests);
  const [entry, setEntry] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (next: string[]) => apiRequest<Interests>('/attendees/me/interests', {
      method: 'PUT', body: { interests: next }, responseSchema: interestsSchema,
    }),
    onSuccess: (result) => {
      queryClient.setQueryData(interestsKey, result);
      void queryClient.invalidateQueries({ queryKey: ['events', 'recommendations'] });
      setDraft(result.interests);
      setSaved(true);
    },
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.interests);

  function add(event: FormEvent) {
    event.preventDefault();
    const value = entry.trim();
    if (value.length === 0) { setInputError('Enter an interest first.'); return; }
    if (value.length > 64) { setInputError('Keep each interest under 65 characters.'); return; }
    if (draft.length >= 50) { setInputError('You can save up to 50 interests.'); return; }
    if (draft.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) { setInputError('That interest is already on your list.'); return; }
    setDraft([...draft, value]);
    setEntry('');
    setInputError(null);
    setSaved(false);
    save.reset();
  }

  function remove(value: string) {
    setDraft(draft.filter((item) => item !== value));
    setSaved(false);
    save.reset();
  }

  return (
    <div>
      <div className="my-6 flex min-h-16 flex-wrap items-start gap-2" aria-label="Selected interests">
        {draft.length === 0 ? <p className="my-1 text-sm text-[var(--muted)]">No interests saved yet. Add a few things you enjoy.</p> : draft.map((interest) => (
          <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--soft)] py-1 pr-1 pl-3 text-xs font-semibold text-[var(--evergreen-deep)]" key={interest}><span className="wrap-anywhere">{interest}</span><button aria-label={`Remove ${interest}`} className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-[var(--line)] disabled:opacity-50" disabled={save.isPending} onClick={() => remove(interest)} type="button"><XIcon aria-hidden="true" className="size-3.5" /></button></span>
        ))}
      </div>
      <form onSubmit={add}>
        <label className="mb-2 block text-xs font-bold text-[var(--ink)]" htmlFor="attendee-interest-input">Add an interest</label>
        <div className="flex flex-wrap gap-2 min-[480px]:flex-nowrap"><input autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-[var(--ink)] focus:border-[var(--focus)] focus:outline-none" id="attendee-interest-input" maxLength={64} onChange={(event) => { setEntry(event.target.value); setInputError(null); }} placeholder="e.g. live music" value={entry} /><button className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--evergreen)] px-4 text-sm font-bold text-white hover:bg-[var(--evergreen-deep)] disabled:cursor-not-allowed disabled:opacity-50 min-[480px]:flex-none" disabled={save.isPending} type="submit"><PlusIcon aria-hidden="true" className="size-4" /> Add</button></div>
        {inputError ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{inputError}</p> : null}
      </form>
      {save.isError ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">Your interests were not saved. {userFacingApiError(save.error)}</p> : null}
      {saved && !dirty ? <p className="mt-4 text-xs font-bold text-[var(--evergreen)]" role="status">Interests saved.</p> : null}
      <div className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-[var(--line)] pt-4 min-[480px]:flex-row min-[480px]:items-center"><span className="text-xs text-[var(--muted)]">{dirty ? 'You have unsaved changes.' : `${draft.length} of 50 interests`}</span><button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 text-sm font-bold text-white hover:bg-[var(--evergreen-deep)] disabled:cursor-not-allowed disabled:opacity-50" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)} type="button">{save.isPending ? 'Saving…' : 'Save interests'}</button></div>
    </div>
  );
}
