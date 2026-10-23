import {
  CalendarBlankIcon,
  MapPinIcon,
  MapTrifoldIcon,
  NavigationArrowIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { getName } from 'country-list';
import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import type {
  EventSearchCriteria,
  EventSearchResult,
} from '../../lib/discovery/discovery.types';
import { useEventSearch } from '../../lib/discovery/useEventSearch';
import { useNearMe, type NearMeState } from '../../lib/location/useNearMe';
import { EventCoverImage } from '../attendee-events/EventCoverImage';
import { Button } from '../ui/Button';

const NEAR_RADIUS_KM = 50;
const EventLocationsMap = lazy(() => import('../attendee-events/EventLocationsMap').then((module) => ({ default: module.EventLocationsMap })));

export function EventSearch() {
  const [input, setInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const nearMe = useNearMe();

  const near =
    nearMe.state.status === 'active'
      ? {
          latitude: nearMe.state.latitude,
          longitude: nearMe.state.longitude,
          radiusKm: NEAR_RADIUS_KM,
        }
      : undefined;
  const criteria: EventSearchCriteria = { query: submittedQuery, near, offset };
  const query = useEventSearch(criteria);
  const mappedEvents = useMemo(() => (query.data?.events ?? []).flatMap((event) =>
    event.venueLatitude === undefined || event.venueLongitude === undefined ? [] : [{
      eventId: event.eventId,
      title: event.title,
      latitude: event.venueLatitude,
      longitude: event.venueLongitude,
      place: eventPlace(event) ?? undefined,
    }]), [query.data]);

  const locating = nearMe.state.status === 'locating';
  const active = nearMe.state.status === 'active';
  const notice = locationNotice(nearMe.state);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const next = input.trim();
    if (next === submittedQuery) {
      if (offset !== 0) { setOffset(0); return; }
      void query.refetch();
      return;
    }
    setSubmittedQuery(next);
    setOffset(0);
  }

  function clearSearch() {
    setInput('');
    setSubmittedQuery('');
    setOffset(0);
    nearMe.disable();
  }

  function toggleNearMe() {
    setOffset(0);
    if (active) nearMe.disable();
    else nearMe.enable();
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex min-w-0 flex-[1_1_20rem] items-end gap-3"
          role="search"
          onSubmit={submitSearch}
        >
          <div className="grid min-w-0 flex-1 gap-2">
            <label className="text-xs font-bold" htmlFor="event-search-query">Search events</label>
            <input
              autoComplete="off"
              className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] hover:border-[var(--focus)] focus:border-[var(--focus)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]/15"
              id="event-search-query"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Name or description"
              type="search"
              value={input}
            />
          </div>
          <Button type="submit" busy={query.isFetching}>
            Search
          </Button>
        </form>
        <Button
          type="button"
          aria-pressed={active}
          busy={locating}
          className={active ? 'border-[var(--evergreen)] bg-[var(--soft)] text-[var(--evergreen-deep)]' : ''}
          onClick={toggleNearMe}
          variant="secondary"
        >
          <NavigationArrowIcon aria-hidden="true" />
          {locating ? 'Locating…' : 'Near me'}
        </Button>
      </div>

      {notice === null ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger)]" role="alert">
          <span>{notice}</span>
          <Button type="button" onClick={nearMe.enable} variant="secondary">
            Try again
          </Button>
        </div>
      )}

      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--evergreen)]/25 bg-[var(--soft)] px-4 py-3 text-sm font-semibold text-[var(--evergreen-deep)]" role="status">
          <span>Showing events within {NEAR_RADIUS_KM} km, closest first.</span>
          <Button type="button" onClick={nearMe.disable} variant="quiet">
            Show all events
          </Button>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div
              className="min-h-28 animate-pulse rounded-2xl bg-[var(--soft)] motion-reduce:animate-none"
              key={item}
            />
          ))}
          <span className="sr-only">Loading events…</span>
        </div>
      ) : query.isError ? (
        <section className="mt-6 grid justify-items-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] px-4 py-12 text-center" role="alert">
          <WarningCircleIcon aria-hidden="true" className="size-8 text-[var(--evergreen)]" />
          <h2 className="my-4 font-[family-name:var(--serif)] text-2xl">Events could not be loaded</h2>
          <p className="mb-3 max-w-lg text-sm leading-relaxed text-[var(--muted)]">{userFacingApiError(query.error)}</p>
          <Button
            type="button"
            onClick={() => {
              void query.refetch();
            }}
            variant="secondary"
          >
            Try again
          </Button>
        </section>
      ) : query.data.events.length === 0 ? (
        <section className="mt-6 grid justify-items-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] px-4 py-12 text-center">
          <CalendarBlankIcon aria-hidden="true" className="size-8 text-[var(--evergreen)]" />
          <h2 className="my-4 font-[family-name:var(--serif)] text-2xl">No events found</h2>
          <Button type="button" onClick={clearSearch} variant="secondary">
            Clear search
          </Button>
        </section>
      ) : (
        <div aria-busy={query.isFetching}>
          <span className="sr-only" role="status">
            {query.isFetching ? 'Updating results…' : ''}
          </span>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--muted)]">{query.data.offset + 1}–{query.data.offset + query.data.events.length} of {query.data.total} {query.data.total === 1 ? 'event' : 'events'}</p>
            <Button aria-expanded={showMap} onClick={() => setShowMap((open) => !open)} type="button" variant="secondary">
              <MapTrifoldIcon aria-hidden="true" /> {showMap ? 'Hide map' : 'Show map'}
            </Button>
          </div>
          {showMap && <div className="mb-5"><Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-[var(--soft)]" role="status">Loading map…</div>}><EventLocationsMap events={mappedEvents} label="Event locations" /></Suspense></div>}
          <ol className="grid list-none gap-3 p-0">
            {query.data.events.map((event) => (
              <SearchResultCard event={event} key={event.eventId} />
            ))}
          </ol>
          {query.data.total > query.data.limit && <nav aria-label="Event result pages" className="mt-5 flex items-center justify-between gap-3">
            <Button type="button" variant="secondary" disabled={query.isFetching || query.data.offset === 0} onClick={() => setOffset(Math.max(0, query.data.offset - query.data.limit))}>Previous</Button>
            <span className="text-sm text-[var(--muted)]">Page {Math.floor(query.data.offset / query.data.limit) + 1} of {Math.ceil(query.data.total / query.data.limit)}</span>
            <Button type="button" variant="secondary" disabled={query.isFetching || query.data.offset + query.data.events.length >= query.data.total} onClick={() => setOffset(query.data.offset + query.data.limit)}>Next</Button>
          </nav>}
        </div>
      )}
    </div>
  );
}

function SearchResultCard({ event }: { event: EventSearchResult }) {
  const place = eventPlace(event);
  return (
    <li className="min-w-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)] focus-within:border-[var(--evergreen)]">
      <Link className="flex min-h-28 flex-wrap items-center justify-between gap-x-5 gap-y-3 p-5 no-underline transition-colors hover:bg-[var(--soft)] max-[460px]:block motion-reduce:transition-none" to={`/attendee/events/${encodeURIComponent(event.eventId)}`} aria-label={`View ${event.title}`}>
      <EventCoverImage className="h-36 w-full rounded-xl object-cover sm:h-28 sm:w-44" />
      <div className="min-w-[min(100%,16rem)] flex-1">
        <h2 className="mb-2 font-[family-name:var(--serif)] text-xl leading-tight tracking-tight text-[var(--ink)]">{event.title}</h2>
        <p className="text-sm font-semibold text-[var(--ink)]">{formatEventDate(event)}</p>
        {place === null ? null : (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <MapPinIcon aria-hidden="true" className="size-4 shrink-0" />
            {place}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-start gap-2 max-[460px]:mt-3">
        {event.distanceKm === undefined ? null : (
          <span className="whitespace-nowrap rounded-full border border-[var(--evergreen)]/25 bg-[var(--soft)] px-2.5 py-1.5 text-xs font-extrabold text-[var(--evergreen-deep)]">
            {formatDistance(event.distanceKm)}
          </span>
        )}
        {event.categories.map((category) => (
          <span className="rounded-full border border-[var(--line)] bg-[var(--workspace)] px-2.5 py-1.5 text-xs font-bold text-[var(--muted)]" key={category}>
            {category}
          </span>
        ))}
      </div>
      <span className="whitespace-nowrap text-xs font-extrabold text-[var(--evergreen-deep)] max-[460px]:mt-4 max-[460px]:block">View event →</span>
      </Link>
    </li>
  );
}

function locationNotice(state: NearMeState): string | null {
  switch (state.status) {
    case 'blocked':
      return 'Your browser is blocking location access. Events are ordered by date instead.';
    case 'unavailable':
      return "We couldn't get your location. Events are ordered by date instead.";
    case 'unlocated':
      return "We couldn't place your location. Events are ordered by date instead.";
    default:
      return null;
  }
}

function formatEventDate(event: EventSearchResult): string {
  if (event.startsAt === undefined) return 'Date to be announced';
  try {
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: event.timeZone,
    }).format(new Date(event.startsAt));
  } catch {
    return 'Date unavailable';
  }
}

function formatDistance(distanceKm: number): string {
  const rounded =
    distanceKm < 10 ? Math.round(distanceKm * 10) / 10 : Math.round(distanceKm);
  return `${String(rounded)} km away`;
}

function eventPlace(event: EventSearchResult): string | null {
  const country =
    event.venueCountryCode === undefined
      ? undefined
      : (getName(event.venueCountryCode) ?? event.venueCountryCode);
  const place = [event.venueName, event.venueCity, country]
    .filter((entry): entry is string => entry !== undefined && entry !== '')
    .join(', ');
  return place === '' ? null : place;
}
