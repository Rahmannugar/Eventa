import { NavLink } from 'react-router-dom';

import type { Actor } from '../../lib/auth/auth.types';

export function ActorSwitch({ actor }: { actor: Actor }) {
  return (
    <nav className="actor-switch" aria-label="Choose how to sign in">
      <NavLink
        className={actor === 'attendee' ? 'actor-switch__active' : ''}
        to="/attendee/login"
      >
        Attendee
      </NavLink>
      <NavLink
        className={actor === 'admin' ? 'actor-switch__active' : ''}
        to="/admin/login"
      >
        Organizer
      </NavLink>
    </nav>
  );
}
