import { ArrowRightIcon, SparkleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { apiRequest } from '../../lib/api/api-client';
import { userFacingApiError } from '../../lib/api/api-error';
import type { EventSearchResult } from '../../lib/discovery/discovery.types';
import { EventCoverImage } from '../attendee-events/EventCoverImage';

const recommendationSchema = z.object({
  events: z.array(z.object({
    eventId: z.string(), title: z.string(), description: z.string().optional(),
    startsAt: z.string().optional(), endsAt: z.string().optional(),
    timeZone: z.string().optional(), categories: z.array(z.string()),
    venueName: z.string().optional(), venueCity: z.string().optional(),
    venueCountryCode: z.string().optional(), distanceKm: z.number().optional(),
  })),
});

export function RecommendedEvents() {
  const recommendations = useQuery({
    queryKey: ['events', 'recommendations'],
    queryFn: ({ signal }) => apiRequest<{ events: EventSearchResult[] }>(
      '/attendees/me/recommendations?limit=6',
      { responseSchema: recommendationSchema, signal },
    ),
    retry: false,
    staleTime: 60_000,
  });

  return (
    <section aria-labelledby="recommended-heading" className="mt-10">
      <div className="mb-5 flex flex-col items-start justify-between gap-3 min-[460px]:flex-row min-[460px]:items-end">
        <h2 className="font-[family-name:var(--serif)] text-[clamp(1.6rem,3vw,2rem)] tracking-tight" id="recommended-heading">Events you might like</h2>
        <Link className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-bold text-[var(--evergreen-deep)] no-underline hover:underline" to="/attendee/search">Explore all <ArrowRightIcon aria-hidden="true" /></Link>
      </div>
      {recommendations.isPending ? (
        <div aria-busy="true" className="grid gap-4 min-[701px]:grid-cols-2 min-[901px]:grid-cols-3">{[0, 1, 2].map((item) => <div className="min-h-44 animate-pulse rounded-2xl bg-[var(--soft)] motion-reduce:animate-none" key={item} />)}<span className="sr-only">Loading recommendations…</span></div>
      ) : recommendations.isError ? (
        <div className="flex min-h-24 flex-wrap items-start gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5" role="alert"><WarningCircleIcon aria-hidden="true" className="size-6 shrink-0 text-[var(--evergreen)]" /><div><strong className="text-sm">Recommendations could not be loaded</strong><p className="mt-1 text-sm text-[var(--muted)]">{userFacingApiError(recommendations.error)}</p></div><button className="ml-auto text-sm font-bold text-[var(--evergreen-deep)]" onClick={() => { void recommendations.refetch(); }} type="button">Try again</button></div>
      ) : recommendations.data.events.length === 0 ? (
        <div className="flex min-h-24 flex-wrap items-start gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5"><SparkleIcon aria-hidden="true" className="size-6 shrink-0 text-[var(--evergreen)]" /><div><strong className="text-sm">Find something you'll enjoy</strong><p className="mt-1 text-sm text-[var(--muted)]">Explore events while we get to know what you like.</p></div><Link className="ml-auto inline-flex items-center gap-1 text-sm font-bold text-[var(--evergreen-deep)]" to="/attendee/search">Find events <ArrowRightIcon aria-hidden="true" /></Link></div>
      ) : (
        <div className="grid gap-4 min-[701px]:grid-cols-2 min-[901px]:grid-cols-3">
          {recommendations.data.events.map((event) => <Link className="flex min-h-72 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] no-underline shadow-[0_10px_28px_rgb(22_59_40_/_4%)] transition-all hover:-translate-y-0.5 hover:border-[var(--evergreen)] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-[var(--focus)] motion-reduce:transition-none" key={event.eventId} to={`/attendee/events/${encodeURIComponent(event.eventId)}`}><EventCoverImage className="h-32 w-full object-cover" /><span className="flex flex-1 flex-col gap-2.5 p-5"><strong className="font-[family-name:var(--serif)] text-xl font-medium leading-tight text-[var(--ink)]">{event.title}</strong><span className="text-xs text-[var(--muted)]">{formatDate(event.startsAt, event.timeZone)}</span><span className="mt-auto inline-flex items-center gap-1 text-xs font-extrabold text-[var(--evergreen-deep)]"><ArrowRightIcon aria-hidden="true" /> View event</span></span></Link>)}
        </div>
      )}
    </section>
  );
}

function formatDate(value?: string, timeZone?: string): string {
  if (!value) return 'Date to be announced';
  try { return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value)); }
  catch { return 'Date unavailable'; }
}
