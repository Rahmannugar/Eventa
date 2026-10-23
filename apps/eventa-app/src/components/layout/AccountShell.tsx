import { SignOutIcon } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import type { Actor } from '../../lib/auth/auth.types';
import { useLogout, useSession } from '../../lib/auth/useAuth';
import { Brand } from '../ui/Brand';
import { Button } from '../ui/Button';
import { DeleteAttendeeAccount } from '../account/DeleteAttendeeAccount';

export function AccountShell({ actor }: { actor: Actor }) {
  const navigate = useNavigate();
  const session = useSession(actor);
  const logout = useLogout(actor);
  const account = session.data;

  if (account === undefined) return null;

  const displayName =
    account.actor === 'attendee' ? `@${account.username}` : 'Organizer';

  async function signOut() {
    try {
      await logout.mutateAsync();
      void navigate(`/${actor}/login`, { replace: true });
    } catch {
      // The mutation error remains visible without clearing a live session.
    }
  }

  return (
    <main className="min-h-screen bg-[var(--workspace)] px-[clamp(1rem,4vw,3rem)] py-6 text-[var(--ink)]">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <Brand />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {actor === 'attendee' ? (
            <Link className="inline-flex min-h-10 items-center rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 text-xs font-bold text-[var(--ink)] no-underline hover:bg-[var(--soft)]" to="/attendee/search">
              Find events
            </Link>
          ) : null}
          <span className="rounded-full bg-[var(--soft)] px-4 py-2 text-xs font-bold text-[var(--evergreen)]">
            {actor === 'admin' ? 'Admin Dashboard' : 'Attendee'}
          </span>
        </div>
      </header>

      <section className="mx-auto mt-[clamp(3rem,8vw,7rem)] grid max-w-3xl gap-6">
        <div>
          <h1 className="font-[var(--serif)] text-[clamp(2.5rem,6vw,4.5rem)] leading-none tracking-[-.055em]">
            {actor === 'admin' ? 'Admin Dashboard' : 'Your Eventa account'}
          </h1>
          <p className="mt-4 text-[var(--muted)]">Signed in as {account.email}.</p>
        </div>

        <article className="grid overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] sm:grid-cols-[13rem_1fr]">
          <div className="grid min-h-32 content-between border-b border-dashed border-[var(--line)] bg-[var(--persimmon)] p-6 text-white sm:min-h-40 sm:border-r sm:border-b-0" aria-hidden="true">
            <span>ACCOUNT</span>
            <strong>{actor === 'admin' ? 'ADMIN' : 'ATTENDEE'}</strong>
          </div>
          <div className="grid content-center gap-2 p-6 [&>span]:text-xs [&>span]:text-[var(--muted)] [&>small]:text-[var(--muted)] [&>strong]:[overflow-wrap:anywhere]">
            <span>Signed in as</span>
            <strong>{account.email}</strong>
            <small>{displayName}</small>
          </div>
        </article>

        {logout.error === null ? null : (
          <div className="rounded-xl border border-red-700/20 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[#812a24]" role="alert">
            {userFacingApiError(logout.error)}
          </div>
        )}

        <Button
          variant="secondary"
          busy={logout.isPending}
          onClick={() => {
            void signOut();
          }}
        >
          <SignOutIcon aria-hidden="true" />
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </Button>

        {actor === 'attendee' ? <DeleteAttendeeAccount /> : null}
      </section>
    </main>
  );
}
