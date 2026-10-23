import { NavLink } from 'react-router-dom';

import type { Actor } from '../../lib/auth/auth.types';

export function ActorSwitch({ actor }: { actor: Actor }) {
  return (
    <nav className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--line)] bg-[var(--soft)] p-1" aria-label="Choose how to sign in">
      <NavLink
        className={`grid min-h-10 place-items-center rounded-lg text-[.82rem] font-bold no-underline ${actor === 'attendee' ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
        to="/attendee/login"
      >
        Attendee
      </NavLink>
      <NavLink
        className={`grid min-h-10 place-items-center rounded-lg text-[.82rem] font-bold no-underline ${actor === 'admin' ? 'bg-[var(--paper)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
        to="/admin/login"
      >
        Organizer
      </NavLink>
    </nav>
  );
}
