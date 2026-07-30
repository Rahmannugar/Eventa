import { RailBoundary } from 'authrail';
import { useCallback, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { isSessionInvalid } from '../../lib/api/api-error';
import { authRail } from '../../lib/auth/auth.rails';
import type { Actor } from '../../lib/auth/auth.types';
import { useSession } from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { Brand } from '../ui/Brand';

function SessionLoader({ actor }: { actor: Actor }) {
  return (
    <main className="session-state" aria-busy="true">
      <Brand />
      <div className="session-state__card">
        <p>Loading {actor === 'admin' ? 'Admin Dashboard' : 'your account'}…</p>
      </div>
    </main>
  );
}

function SessionFailure({ retry }: { retry: () => Promise<unknown> }) {
  return (
    <main className="session-state">
      <Brand />
      <div className="session-state__card" role="alert">
        <h1>Unable to load your account</h1>
        <p>Check your connection and try again.</p>
        <Button
          onClick={() => {
            void retry();
          }}
        >
          Try again
        </Button>
      </div>
    </main>
  );
}

export function PublicSessionBoundary({
  actor,
  children,
}: {
  actor: Actor;
  children: ReactNode;
}) {
  const session = useSession(actor);

  if (session.data !== undefined) return <Navigate replace to={`/${actor}`} />;

  return children;
}

export function ProtectedSessionBoundary({ actor }: { actor: Actor }) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession(actor);
  const redirect = useCallback(
    (to: string) => {
      void navigate(to, {
        replace: true,
        state: { from: `${location.pathname}${location.search}` },
      });
    },
    [location.pathname, location.search, navigate],
  );

  if (session.isPending) return <SessionLoader actor={actor} />;

  if (session.error !== null && !isSessionInvalid(session.error)) {
    return <SessionFailure retry={session.refetch} />;
  }

  return (
    <RailBoundary
      rail={authRail(actor)}
      context={{ user: session.data ?? null }}
      fallback={<SessionLoader actor={actor} />}
      denied={<Navigate replace to={`/${actor}/login`} />}
      onRedirect={redirect}
    >
      <Outlet />
    </RailBoundary>
  );
}
