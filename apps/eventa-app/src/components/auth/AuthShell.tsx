import type { ReactNode } from 'react';

import { Brand } from '../ui/Brand';
import type { Actor } from '../../lib/auth/auth.types';
import { ActorSwitch } from './ActorSwitch';

const actorContent = {
  admin: {
    headline: 'Manage Eventa.',
    supporting: 'Sign in to the Admin Dashboard.',
  },
  attendee: {
    headline: 'Welcome back.',
    supporting: 'Sign in to your Eventa account.',
  },
} as const;

export function AuthShell({
  actor,
  children,
  headline,
  supporting,
}: {
  actor: Actor;
  children: ReactNode;
  headline?: string;
  supporting?: string;
}) {
  const content = actorContent[actor];

  return (
    <main className={`auth-canvas auth-canvas--${actor}`}>
      <section className="auth-story" aria-labelledby="eventa-story-title">
        <Brand inverse />
        <div className="auth-story__content">
          <h1 id="eventa-story-title">{headline ?? content.headline}</h1>
          <p>{supporting ?? content.supporting}</p>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__mobile-brand">
          <Brand />
        </div>
        <div className="auth-panel__content">
          <ActorSwitch actor={actor} />
          {children}
        </div>
      </section>
    </main>
  );
}
