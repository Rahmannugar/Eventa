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
    <main className="grid min-h-screen bg-[var(--paper)] min-[900px]:grid-cols-[minmax(0,1.12fr)_minmax(31rem,.88fr)]">
      <section className={`relative hidden min-h-screen flex-col overflow-hidden p-10 text-[#fffdf8] min-[900px]:flex ${actor === 'admin' ? 'bg-[linear-gradient(145deg,#17231d,#294037)]' : 'bg-[linear-gradient(145deg,#073c31,#0e684f)]'}`} aria-labelledby="eventa-story-title">
        <Brand inverse />
        <div className="relative z-10 mt-auto mb-32 max-w-xl">
          <h1 className="my-5 max-w-[9.5em] font-[Georgia] text-[clamp(3.25rem,5.4vw,5.7rem)] leading-[.94] font-medium tracking-[-.055em]" id="eventa-story-title">{headline ?? content.headline}</h1>
          <p className="max-w-lg text-base leading-7 text-white/75">{supporting ?? content.supporting}</p>
        </div>
      </section>

      <section className="flex min-h-screen justify-center overflow-y-auto bg-[var(--paper)] p-6 min-[900px]:p-12">
        <div className="absolute top-6 left-6 min-[900px]:hidden">
          <Brand />
        </div>
        <div className="my-auto w-full max-w-[27rem] pt-26 pb-8 min-[900px]:py-8">
          <ActorSwitch actor={actor} />
          {children}
        </div>
      </section>
    </main>
  );
}
