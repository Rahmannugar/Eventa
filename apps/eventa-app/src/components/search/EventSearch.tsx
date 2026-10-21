import {
  CalendarBlankIcon,
  MapPinIcon,
  NavigationArrowIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { getName } from 'country-list';
import { useState, type FormEvent } from 'react';

import { userFacingApiError } from '../../lib/api/api-error';
import type {
  EventSearchCriteria,
  EventSearchResult,
} from '../../lib/discovery/discovery.types';
import { useEventSearch } from '../../lib/discovery/useEventSearch';
import { useNearMe, type NearMeState } from '../../lib/location/useNearMe';
import { Button } from '../ui/Button';

const NEAR_RADIUS_KM = 50;

export function EventSearch() {
  const [input, setInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const nearMe = useNearMe();

  const near =
    nearMe.state.status === 'active'
      ? {
          latitude: nearMe.state.latitude,
          longitude: nearMe.state.longitude,
          radiusKm: NEAR_RADIUS_KM,
        }
      : undefined;
  const criteria: EventSearchCriteria = { query: submittedQuery, near };
  const query = useEventSearch(criteria);

  const locating = nearMe.state.status === 'locating';
  const active = nearMe.state.status === 'active';
  const notice = locationNotice(nearMe.state);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const next = input.trim();
    if (next === submittedQuery) {
      void query.refetch();
      return;
    }
    setSubmittedQuery(next);
  }

  function clearSearch() {
    setInput('');
    setSubmittedQuery('');
    nearMe.disable();
  }

  function toggleNearMe() {
    if (active) nearMe.disable();
    else nearMe.enable();
  }

  return (
    <div className="event-search">
      <div className="event-search__controls">
        <form className="event-search__form" role="search" onSubmit={submitSearch}>
          <div className="field">
            <label htmlFor="event-search-query">Search events</label>
            <input
              autoComplete="off"
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
          onClick={toggleNearMe}
          variant="secondary"
        >
          <NavigationArrowIcon aria-hidden="true" />
          {locating ? 'Locating…' : 'Near me'}
        </Button>
      </div>

      {notice === null ? null : (
        <div className="form-alert form-alert--action" role="alert">
          <span>{notice}</span>
          <Button type="button" onClick={nearMe.enable} variant="secondary">
            Try again
          </Button>
        </div>
      )}

      {active ? (
        <div className="form-status form-status--action" role="status">
          <span>
            Showing events within {NEAR_RADIUS_KM} km, closest first.
          </span>
          <Button type="button" onClick={nearMe.disable} variant="quiet">
            Show all events
          </Button>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="event-search-results" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div className="event-search-card event-search-card--skeleton" key={item} />
          ))}
          <span className="visually-hidden">Loading events…</span>
        </div>
      ) : query.isError ? (
        <section className="event-list-state" role="alert">
          <WarningCircleIcon aria-hidden="true" />
          <h2>Events could not be loaded</h2>
          <p>{userFacingApiError(query.error)}</p>
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
        <section className="event-list-state">
          <CalendarBlankIcon aria-hidden="true" />
          <h2>No events found</h2>
          <Button type="button" onClick={clearSearch} variant="secondary">
            Clear search
          </Button>
        </section>
      ) : (
        <div
          aria-busy={query.isFetching}
          className="event-search__results"
        >
          <span className="visually-hidden" role="status">
            {query.isFetching ? 'Updating results…' : ''}
          </span>
          <ol className="event-search-results">
            {query.data.events.map((event) => (
              <SearchResultCard event={event} key={event.eventId} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function SearchResultCard({ event }: { event: EventSearchResult }) {
  const place = eventPlace(event);
  return (
    <li className="event-search-card">
      <div className="event-search-card__body">
        <h2>{event.title}</h2>
        <p className="event-search-card__date">{formatEventDate(event)}</p>
        {place === null ? null : (
          <p className="event-search-card__place">
            <MapPinIcon aria-hidden="true" />
            {place}
          </p>
        )}
      </div>
      <div className="event-search-card__meta">
        {event.distanceKm === undefined ? null : (
          <span className="event-search-card__distance">
            {formatDistance(event.distanceKm)}
          </span>
        )}
        {event.categories.map((category) => (
          <span className="event-search-card__category" key={category}>
            {category}
          </span>
        ))}
      </div>
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
    distanceKm < 10
      ? Math.round(distanceKm * 10) / 10
      : Math.round(distanceKm);
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
