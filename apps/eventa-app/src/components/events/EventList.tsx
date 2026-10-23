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
import { primaryLink, statusBadge } from './adminStyles';

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
    <main className="mx-auto w-full max-w-[94rem] px-[clamp(1rem,4vw,3rem)] py-[clamp(2rem,5vw,4.5rem)] max-[560px]:px-4 max-[560px]:py-6">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-[clamp(1.5rem,4vw,2.5rem)] max-[560px]:flex-col max-[560px]:items-stretch">
        <h1 className="font-[var(--serif)] text-[clamp(2.65rem,7vw,4.6rem)] font-medium leading-none tracking-[-.055em]">Events</h1>
        <Link className={`${primaryLink} max-[560px]:w-full`} to="/admin/events/new">
          <PlusIcon aria-hidden="true" />
          Create event
        </Link>
      </header>

      <section className="mt-6 grid grid-cols-1 items-end gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 min-[561px]:grid-cols-2 min-[1100px]:grid-cols-[minmax(16rem,1.6fr)_repeat(3,minmax(10rem,1fr))]" aria-label="Find events">
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
        <div className="grid min-w-0 gap-1.5 text-sm">
          <label className="text-xs font-bold text-[var(--muted)]" htmlFor="event-sort">Sort by</label>
          <select className="min-h-11 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--ink)]"
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
            <div className="mt-5 flex items-center justify-between rounded-xl border border-red-700/20 bg-[var(--danger-soft)] px-3 py-2 text-xs font-bold text-[#812a24]" role="alert">
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
            className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)] max-[560px]:rounded-none max-[560px]:border-0 max-[560px]:bg-transparent max-[560px]:shadow-none"
            aria-label="Events"
            aria-busy={query.isFetching && !query.isFetchingNextPage}
          >
            <div className="grid grid-cols-[minmax(14rem,1.45fr)_minmax(10rem,1fr)_minmax(12rem,1.15fr)_8rem_1.5rem] items-center gap-4 border-b border-[var(--line)] bg-[var(--soft)] px-4 py-3 text-[11px] font-extrabold tracking-wide text-[var(--muted)] uppercase max-[560px]:hidden" aria-hidden="true">
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
            <div className="flex justify-center pt-5">
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
    <div className="grid min-w-0 gap-1.5 text-sm">
      <label className="text-xs font-bold text-[var(--muted)]" htmlFor="event-search">Search by name</label>
      <div className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[var(--muted)] [&_svg]:w-4">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input className="min-w-0 flex-1 border-0 bg-transparent text-[var(--ink)] outline-none"
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
    <Link className="grid min-h-24 grid-cols-[minmax(14rem,1.45fr)_minmax(10rem,1fr)_minmax(12rem,1.15fr)_8rem_1.5rem] items-center gap-4 border-b border-[var(--line)] p-4 text-[var(--ink)] no-underline transition-colors last:border-0 hover:bg-[var(--soft)] max-[560px]:mb-3 max-[560px]:min-h-0 max-[560px]:grid-cols-[minmax(0,1fr)_auto] max-[560px]:gap-x-3 max-[560px]:gap-y-4 max-[560px]:rounded-2xl max-[560px]:border max-[560px]:bg-[var(--paper)]" to={`/admin/events/${event.eventId}`}>
      <div className="min-w-0 max-[560px]:col-start-1">
        <div className="flex min-w-0 items-center gap-2">
          <strong className="truncate text-sm">{event.title}</strong>
          <span className={statusBadge(event.status)}>
            {event.status === 'draft'
              ? 'Draft'
              : event.status === 'cancelled'
                ? 'Cancelled'
                : 'Published'}
          </span>
        </div>
        {event.categories.length === 0 ? null : (
          <div className="mt-2 flex flex-wrap gap-1 [&_span]:rounded-full [&_span]:bg-[var(--soft)] [&_span]:px-2 [&_span]:py-1 [&_span]:text-[10px] [&_span]:font-bold [&_span]:text-[var(--muted)]">
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
      <ArrowRightIcon className="w-4 text-[var(--muted)] max-[560px]:col-start-2 max-[560px]:row-start-1" aria-hidden="true" />
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
    <div className="min-w-0 max-[560px]:col-span-full">
      <small className="mb-1 hidden text-[10px] font-extrabold text-[var(--muted)] uppercase max-[560px]:block">{label}</small>
      <span className="flex items-start gap-1.5 overflow-hidden text-xs leading-normal text-[var(--muted)] [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-[var(--evergreen)]">
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
    <section className="mt-6 grid justify-items-center rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-4 py-[clamp(3rem,8vw,6rem)] text-center [&>svg]:size-8 [&>svg]:text-[var(--evergreen)]">
      <CalendarBlankIcon aria-hidden="true" />
      <h2 className="my-4 font-[var(--serif)] text-[1.7rem]">{filtered ? 'No events found' : 'No events yet'}</h2>
      {filtered ? (
        <Button type="button" variant="secondary" onClick={clear}>
          Clear filters
        </Button>
      ) : (
        <Link className={primaryLink} to="/admin/events/new">
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
    <section className="mt-6 grid justify-items-center rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-4 py-[clamp(3rem,8vw,6rem)] text-center [&>svg]:size-8 [&>svg]:text-[var(--evergreen)]" role="alert">
      <WarningCircleIcon aria-hidden="true" />
      <h2 className="my-4 font-[var(--serif)] text-[1.7rem]">Events could not be loaded</h2>
      <Button type="button" variant="secondary" onClick={retry}>
        Try again
      </Button>
    </section>
  );
}

function EventListLoading() {
  return (
    <div
      className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)]"
      aria-busy="true"
      aria-label="Loading events"
    >
      {[0, 1, 2, 3].map((item) => (
        <div className="min-h-24 animate-pulse bg-[var(--paper)]" key={item} />
      ))}
      <span className="sr-only">Loading events…</span>
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
