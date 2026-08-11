import {
  CalendarDotsIcon,
  SignOutIcon,
  TicketIcon,
} from '@phosphor-icons/react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import { useLogout, useSession } from '../../lib/auth/useAuth';
import { Brand } from '../ui/Brand';
import { Button } from '../ui/Button';

export function AdminDashboardShell() {
  const navigate = useNavigate();
  const session = useSession('admin');
  const logout = useLogout('admin');
  const account = session.data;

  if (account?.actor !== 'admin') return null;

  async function signOut() {
    try {
      await logout.mutateAsync();
      void navigate('/admin/login', { replace: true });
    } catch {
      // The shell keeps the live session and presents the recoverable error.
    }
  }

  return (
    <div className="admin-workspace">
      <aside className="admin-sidebar">
        <div>
          <Brand inverse to="/admin" />
          <p className="admin-sidebar__label">Organizer workspace</p>
        </div>

        <nav className="admin-navigation" aria-label="Admin Dashboard">
          <p>Manage</p>
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `admin-navigation__link${isActive ? ' is-active' : ''}`
            }
          >
            <CalendarDotsIcon aria-hidden="true" />
            Events
          </NavLink>
        </nav>

        <div className="admin-account">
          <span className="admin-account__avatar" aria-hidden="true">
            <TicketIcon weight="fill" />
          </span>
          <div>
            <strong>Organizer</strong>
            <span title={account.email}>{account.email}</span>
          </div>
          <button
            type="button"
            className="admin-account__signout"
            aria-label="Sign out"
            disabled={logout.isPending}
            onClick={() => {
              void signOut();
            }}
          >
            <SignOutIcon aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="admin-workspace__body">
        <header className="admin-mobile-header">
          <Brand to="/admin" />
          <NavLink to="/admin" end>
            Events
          </NavLink>
          <Button
            variant="quiet"
            aria-label="Sign out"
            busy={logout.isPending}
            onClick={() => {
              void signOut();
            }}
          >
            <SignOutIcon aria-hidden="true" />
          </Button>
        </header>

        {logout.error === null ? null : (
          <div className="admin-shell-alert" role="alert">
            {userFacingApiError(logout.error)}
          </div>
        )}

        <Outlet />
      </div>
    </div>
  );
}
