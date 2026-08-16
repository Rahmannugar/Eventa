import {
  ArrowRightIcon,
  CalendarBlankIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { getName } from 'country-list';
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';

import { isSessionInvalid } from '../../lib/api/api-error';
import type {
  AdminEventListCriteria,
  AdminEventSort,
  AdminEventSummary,
} from '../../lib/events/event.types';
import { useAdminEvents } from '../../lib/events/useEvents';
import {
  countryOptions,
  regionOptions,
} from '../../lib/location/location-data';
import { Button } from '../ui/Button';
import { SearchSelect } from './EventFormFields';

export function EventList() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const criteria = readCriteria(searchParams);
  const regions = useMemo(
    () => regionOptions(criteria.countryCode),
    [criteria.countryCode],
  );
  const query = useAdminEvents(criteria);

  if (query.error !== null && isSessionInvalid(query.error)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];
  const criteriaLoadFailed =
    query.error !== null && (query.isPlaceholderData || events.length === 0);

  return (
    <main className="admin-page admin-page--events">
      <header className="event-list-header">
        <h1>Events</h1>
        <Link className="button button--primary" to="/admin/events/new">
          <PlusIcon aria-hidden="true" />
          Create event
        </Link>
      </header>

      <section className="event-catalogue-controls" aria-label="Find events">
        <CatalogueSearch
          key={criteria.search}
          initialValue={criteria.search}
          onChange={(value) =>
            setCatalogueParam(setSearchParams, 'q', value, true)
          }
        />
        <SearchSelect
          id="event-country-filter"
          label="Country"
          options={[{ label: 'All countries', value: '' }, ...countryOptions]}
          value={criteria.countryCode}
          placeholder="All countries"
          onChange={(value) => {
            setSearchParams((current) => {
              const next = new URLSearchParams(current);
              if (value === '') next.delete('country');
              else next.set('country', value);
              next.delete('region');
              return next;
            });
          }}
        />
        <SearchSelect
          id="event-region-filter"
          label="State or region"
          disabled={criteria.countryCode === '' || regions.length === 0}
          options={[{ label: 'All states or regions', value: '' }, ...regions]}
          value={criteria.regionCode}
          placeholder={
            criteria.countryCode === ''
              ? 'Choose a country first'
              : 'All states or regions'
          }
          onChange={(value) =>
            setCatalogueParam(setSearchParams, 'region', value)
          }
        />
        <div className="field">
          <label htmlFor="event-sort">Sort by</label>
          <select
            id="event-sort"
            value={criteria.sort}
            onChange={(event) =>
              setCatalogueParam(setSearchParams, 'sort', event.target.value)
            }
          >
            <option value="updated_desc">Recently updated</option>
            <option value="event_date_asc">Event date, earliest</option>
            <option value="event_date_desc">Event date, latest</option>
          </select>
        </div>
      </section>

      {query.isPending ? (
        <EventListLoading />
      ) : criteriaLoadFailed ? (
        <EventListError retry={() => void query.refetch()} />
      ) : events.length === 0 ? (
        <EventListEmpty
          filtered={hasCriteria(criteria)}
          clear={() => {
            setSearchParams({});
          }}
        />
      ) : (
        <>
          {query.error === null ? null : (
            <div className="event-list__load-error" role="alert">
              More events could not be loaded.
              <Button
                variant="quiet"
                type="button"
                onClick={() => void query.fetchNextPage()}
              >
                Try again
              </Button>
            </div>
          )}
          <div
            className="event-list"
            aria-label="Events"
            aria-busy={query.isFetching && !query.isFetchingNextPage}
          >
            <div className="event-list__head" aria-hidden="true">
              <span>Event</span>
              <span>Date</span>
              <span>Venue</span>
              <span>Updated</span>
              <span />
            </div>
            {events.map((event) => (
              <EventListItem event={event} key={event.eventId} />
            ))}
          </div>
          {query.hasNextPage ? (
            <div className="event-list__more">
              <Button
                type="button"
                variant="secondary"
                busy={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? 'Loading events…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

function CatalogueSearch({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: Dispatch<string>;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = value.trim();
      if (normalized !== initialValue) onChange(normalized);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [initialValue, onChange, value]);

  return (
    <div className="field event-catalogue-controls__search">
      <label htmlFor="event-search">Search by name</label>
      <div className="event-catalogue-controls__search-input">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          id="event-search"
          type="search"
          maxLength={160}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    </div>
  );
}

function EventListItem({ event }: { event: AdminEventSummary }) {
  return (
    <Link className="event-list__item" to={`/admin/events/${event.eventId}`}>
      <div className="event-list__identity">
        <div className="event-list__name-line">
          <strong>{event.title}</strong>
          <span className={`status-badge status-badge--${event.status}`}>
            {event.status === 'draft' ? 'Draft' : 'Published'}
          </span>
        </div>
        {event.categories.length === 0 ? null : (
          <div className="event-list__categories">
            {event.categories.map((category) => (
              <span key={category}>{category}</span>
            ))}
          </div>
        )}
      </div>
      <EventDatum icon={<CalendarBlankIcon aria-hidden="true" />} label="Date">
        {formatEventDate(event)}
      </EventDatum>
      <EventDatum icon={<MapPinIcon aria-hidden="true" />} label="Venue">
        {formatVenue(event)}
      </EventDatum>
      <EventDatum label="Updated">
        {formatUpdatedAt(event.updatedAt)}
      </EventDatum>
      <ArrowRightIcon className="event-list__arrow" aria-hidden="true" />
    </Link>
  );
}

function EventDatum({
  children,
  icon,
  label,
}: {
  children: string;
  icon?: ReactNode;
  label: string;
}) {
  return (
    <div className="event-list__datum">
      <small>{label}</small>
      <span>
        {icon}
        {children}
      </span>
    </div>
  );
}

function EventListEmpty({
  clear,
  filtered,
}: {
  clear: () => void;
  filtered: boolean;
}) {
  return (
    <section className="event-list-state">
      <CalendarBlankIcon aria-hidden="true" />
      <h2>{filtered ? 'No events found' : 'No events yet'}</h2>
      {filtered ? (
        <Button type="button" variant="secondary" onClick={clear}>
          Clear filters
        </Button>
      ) : (
        <Link className="button button--primary" to="/admin/events/new">
          <PlusIcon aria-hidden="true" />
          Create event
        </Link>
      )}
    </section>
  );
}

function readCriteria(searchParams: URLSearchParams): AdminEventListCriteria {
  const countryCode = searchParams.get('country')?.toUpperCase() ?? '';
  const validCountry = countryOptions.some(({ value }) => value === countryCode)
    ? countryCode
    : '';
  const requestedRegion = searchParams.get('region')?.toUpperCase() ?? '';
  const regionCode = regionOptions(validCountry).some(
    ({ value }) => value === requestedRegion,
  )
    ? requestedRegion
    : '';
  const requestedSort = searchParams.get('sort');
  const sort: AdminEventSort = [
    'event_date_asc',
    'event_date_desc',
    'updated_desc',
  ].includes(requestedSort ?? '')
    ? (requestedSort as AdminEventSort)
    : 'updated_desc';

  return {
    search: (searchParams.get('q') ?? '').trim().slice(0, 160),
    countryCode: validCountry,
    regionCode,
    sort,
  };
}

function hasCriteria(criteria: AdminEventListCriteria): boolean {
  return (
    criteria.search !== '' ||
    criteria.countryCode !== '' ||
    criteria.regionCode !== '' ||
    criteria.sort !== 'updated_desc'
  );
}

function setCatalogueParam(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  name: string,
  value: string,
  replace = false,
) {
  setSearchParams(
    (current) => {
      const next = new URLSearchParams(current);
      if (value === '' || (name === 'sort' && value === 'updated_desc')) {
        next.delete(name);
      } else {
        next.set(name, value);
      }
      return next;
    },
    { replace },
  );
}

function EventListError({ retry }: { retry: () => void }) {
  return (
    <section className="event-list-state" role="alert">
      <WarningCircleIcon aria-hidden="true" />
      <h2>Events could not be loaded</h2>
      <Button type="button" variant="secondary" onClick={retry}>
        Try again
      </Button>
    </section>
  );
}

function EventListLoading() {
  return (
    <div
      className="event-list event-list--loading"
      aria-busy="true"
      aria-label="Loading events"
    >
      {[0, 1, 2, 3].map((item) => (
        <div className="event-list__skeleton" key={item} />
      ))}
      <span className="visually-hidden">Loading events…</span>
    </div>
  );
}

function formatEventDate(event: AdminEventSummary): string {
  if (event.startsAt === undefined) return 'Not scheduled';
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

function formatVenue(event: AdminEventSummary): string {
  if (event.venue === undefined) return 'No venue';
  const country = getName(event.venue.countryCode) ?? event.venue.countryCode;
  return [event.venue.name, event.venue.city, country]
    .filter(Boolean)
    .join(', ');
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
    new Date(value),
  );
}
