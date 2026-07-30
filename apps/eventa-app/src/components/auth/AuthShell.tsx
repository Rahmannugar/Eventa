import type { ReactNode } from 'react';

import type { Actor } from '../../lib/auth/auth.types';
import { Brand } from '../ui/Brand';
import { ActorSwitch } from './ActorSwitch';

const actorContent = {
  admin: {
    eyebrow: 'Organizer access',
    headline: 'Manage your events in one place.',
    supporting:
      'Create and publish events, manage attendees, and track event performance from the Admin Dashboard.',
    note: 'Admin access is available only to approved organizers.',
  },
  attendee: {
    eyebrow: 'Attendee access',
    headline: 'Find and manage your events.',
    supporting:
      'Discover events, buy tickets, and keep your event details and tickets in one account.',
    note: 'New here? Account creation arrives in the next authentication slice.',
  },
} as const;

export function AuthShell({
  actor,
  children,
}: {
  actor: Actor;
  children: ReactNode;
}) {
  const content = actorContent[actor];

  return (
    <main className={`auth-canvas auth-canvas--${actor}`}>
      <section className="auth-story" aria-labelledby="eventa-story-title">
        <Brand inverse />
        <div className="auth-story__content">
          <p className="eyebrow">{content.eyebrow}</p>
          <h1 id="eventa-story-title">{content.headline}</h1>
          <p>{content.supporting}</p>
        </div>
        <div className="event-stub" aria-hidden="true">
          <span>EVENTA / ADMIT ONE</span>
          <span className="event-stub__code">EV—27</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__mobile-brand">
          <Brand />
        </div>
        <div className="auth-panel__content">
          <ActorSwitch actor={actor} />
          {children}
          <p className="auth-panel__note">{content.note}</p>
        </div>
      </section>
    </main>
  );
}
