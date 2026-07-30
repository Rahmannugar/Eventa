import { SignOutIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';

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
    <main className={`account-shell account-shell--${actor}`}>
      <header className="account-shell__header">
        <Brand />
        <span className="actor-badge">
          {actor === 'admin' ? 'Admin Dashboard' : 'Attendee'}
        </span>
      </header>

      <section className="account-shell__content">
        <div>
          <h1>
            {actor === 'admin' ? 'Admin Dashboard' : 'Your Eventa account'}
          </h1>
          <p className="account-shell__intro">Signed in as {account.email}.</p>
        </div>

        <article className="account-card">
          <div className="account-card__ticket" aria-hidden="true">
            <span>ACCOUNT</span>
            <strong>{actor === 'admin' ? 'ADMIN' : 'ATTENDEE'}</strong>
          </div>
          <div className="account-card__details">
            <span>Signed in as</span>
            <strong>{account.email}</strong>
            <small>{displayName}</small>
          </div>
        </article>

        {logout.error === null ? null : (
          <div className="form-alert" role="alert">
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
