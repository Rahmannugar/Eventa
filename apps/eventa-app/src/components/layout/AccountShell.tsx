import { SignOutIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import type { Actor } from '../../lib/auth/auth.types';
import { useLogout, useSession } from '../../lib/auth/useAuth';
import { Brand } from '../ui/Brand';
import { Button } from '../ui/Button';

export function AccountShell({ actor }: { actor: Actor }) {
  const navigate = useNavigate();
  const session = useSession(actor);
  const logout = useLogout(actor);
  const account = session.data;

  if (account === undefined) return null;

  const displayName =
    account.actor === 'attendee'
      ? `@${account.username}`
      : 'Approved organizer';

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
          <p className="eyebrow">
            {actor === 'admin'
              ? 'Organizer session active'
              : 'Your attendee pass is active'}
          </p>
          <h1>
            {actor === 'admin' ? 'Admin Dashboard' : 'Your Eventa account'}
          </h1>
          <p className="account-shell__intro">
            {actor === 'admin'
              ? 'Your organizer session is active and separate from attendee access.'
              : 'Your attendee session is active and ready for future event and ticket features.'}
          </p>
        </div>

        <article className="account-card">
          <div className="account-card__ticket" aria-hidden="true">
            <span>SESSION</span>
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
      </section>
    </main>
  );
}
