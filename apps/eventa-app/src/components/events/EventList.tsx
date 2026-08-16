import {
  ArrowRightIcon,
  CalendarBlankIcon,
  MapPinIcon,
  PlusIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { getName } from 'country-list';
import type { ReactNode } from 'react';

import { isSessionInvalid } from '../../lib/api/api-error';
import type { AdminEventSummary } from '../../lib/events/event.types';
import { useAdminEvents } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';

export function EventList() {
  const location = useLocation();
  const query = useAdminEvents();

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

  return (
    <main className="admin-page admin-page--events">
      <header className="event-list-header">
        <h1>Events</h1>
        <Link className="button button--primary" to="/admin/events/new">
          <PlusIcon aria-hidden="true" />
          Create event
        </Link>
      </header>

      {query.isPending ? (
        <EventListLoading />
      ) : query.error !== null && events.length === 0 ? (
        <EventListError retry={() => void query.refetch()} />
      ) : events.length === 0 ? (
        <EventListEmpty />
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
          <div className="event-list" aria-label="Events">
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

function EventListItem({ event }: { event: AdminEventSummary }) {
  return (
    <Link className="event-list__item" to={`/admin/events/${event.eventId}`}>
      <div className="event-list__identity">
        <div className="event-list__name-line">
          <strong>{event.title}</strong>
          <span className={`status-badge status-badge--${event.status}`}>
            {event.status === 'draft' ? 'Private' : 'Published'}
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

function EventListEmpty() {
  return (
    <section className="event-list-state">
      <CalendarBlankIcon aria-hidden="true" />
      <h2>No events yet</h2>
      <Link className="button button--primary" to="/admin/events/new">
        <PlusIcon aria-hidden="true" />
        Create event
      </Link>
    </section>
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
