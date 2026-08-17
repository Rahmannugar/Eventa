import {
  ArrowLeftIcon,
  CalendarBlankIcon,
  ImageIcon,
  MapPinIcon,
  NotePencilIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { getName } from 'country-list';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';

import { ApiError, isSessionInvalid } from '../../lib/api/api-error';
import type {
  AdminEvent,
  AdminEventMedia,
  EventVenue,
} from '../../lib/events/event.types';
import { useAdminEvent } from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { EventMediaManager } from './EventMediaManager';
import { EventPublication } from './EventPublication';
import { EventRetirement } from './EventRetirement';
import { EventTicketTypes } from './EventTicketTypes';

const eventIdSchema = z.uuid();
const gallerySlotOrder = ['gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'];

export function EventDetails({ eventId }: { eventId: string }) {
  const location = useLocation();
  const validEventId = eventIdSchema.safeParse(eventId).success;
  const eventQuery = useAdminEvent(eventId, validEventId);

  if (!validEventId) return <EventState title="This event link is not valid" />;
  if (eventQuery.isPending) return <EventDetailsLoading />;
  if (eventQuery.error !== null && isSessionInvalid(eventQuery.error)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  if (eventQuery.error !== null && eventQuery.data === undefined) {
    const notFound =
      eventQuery.error instanceof ApiError &&
      eventQuery.error.statusCode === 404;
    return notFound ? (
      <EventState title="Event not found" />
    ) : (
      <EventState
        title="Event could not be loaded"
        retry={() => void eventQuery.refetch()}
      />
    );
  }

  return (
    <EventDetailsContent
      event={eventQuery.data}
      reload={async () => {
        const result = await eventQuery.refetch();
        if (result.error !== null) throw result.error;
        if (result.data === undefined) {
          throw new Error('Event details were not returned.');
        }
        return result.data;
      }}
    />
  );
}

function EventDetailsContent({
  event,
  reload,
}: {
  event: AdminEvent;
  reload: () => Promise<AdminEvent>;
}) {
  const [mediaBusy, setMediaBusy] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [retirementBusy, setRetirementBusy] = useState(false);
  const [ticketTypeBusy, setTicketTypeBusy] = useState(false);
  const cover = event.media.find((media) => media.slot === 'cover');
  const gallery = event.media
    .filter((media) => media.slot !== 'cover')
    .sort(
      (first, second) =>
        gallerySlotOrder.indexOf(first.slot) -
        gallerySlotOrder.indexOf(second.slot),
    );

  return (
    <main className="admin-page admin-page--event-details">
      <header className="event-details-header">
        <Link className="back-link" to="/admin">
          <ArrowLeftIcon aria-hidden="true" />
          Events
        </Link>
        <div className="event-details-header__main">
          <div>
            <div className="event-details-header__state">
              <span className={`status-badge status-badge--${event.status}`}>
                {event.status === 'draft' ? 'Draft' : 'Published'}
              </span>
            </div>
            <h1>{event.title}</h1>
          </div>
          {event.status === 'draft' ? (
            <Link
              className="button button--primary"
              to={`/admin/events/${event.eventId}/edit`}
            >
              <NotePencilIcon aria-hidden="true" />
              Edit event
            </Link>
          ) : null}
        </div>
      </header>

      <div className="event-details-layout">
        <div className="event-details-main">
          <section
            className="event-details-section"
            aria-labelledby="about-title"
          >
            <div className="event-details-section__heading">
              <h2 id="about-title">About</h2>
            </div>
            <div className="event-details-section__body event-details-about">
              <p>{event.description ?? 'No description added.'}</p>
              <div className="event-details-categories" aria-label="Categories">
                {event.categories.map((category) => (
                  <span key={category}>{category}</span>
                ))}
              </div>
            </div>
          </section>

          <EventTicketTypes
            disabled={mediaBusy || publicationBusy || retirementBusy}
            event={event}
            onOperationChange={setTicketTypeBusy}
            reload={reload}
          />

          <section
            className="event-details-section"
            aria-labelledby="media-title"
          >
            <div className="event-details-section__heading">
              <h2 id="media-title">Images</h2>
            </div>
            <div className="event-details-section__body event-details-media">
              {event.status === 'draft' ? (
                <EventMediaManager
                  disabled={publicationBusy || retirementBusy || ticketTypeBusy}
                  event={event}
                  onOperationChange={setMediaBusy}
                />
              ) : (
                <>
                  <MediaSlot
                    className="event-details-cover"
                    media={cover}
                    emptyLabel="No cover image"
                    alt={cover === undefined ? '' : `${event.title} cover`}
                  />
                  <div className="event-details-gallery" aria-label="Gallery">
                    {gallery.length === 0 ? (
                      <div className="event-details-media__empty">
                        <ImageIcon aria-hidden="true" />
                        <span>No gallery images</span>
                      </div>
                    ) : (
                      gallery.map((media, index) => (
                        <MediaSlot
                          key={media.mediaId}
                          media={media}
                          alt={`${event.title} gallery image ${String(index + 1)}`}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <div className="event-details-rail">
          <aside className="event-details-summary" aria-label="Event summary">
            <DetailGroup
              icon={<CalendarBlankIcon aria-hidden="true" />}
              title="Schedule"
            >
              <DetailValue label="Starts">
                {formatEventInstant(event.startsAt, event.timeZone)}
              </DetailValue>
              <DetailValue label="Ends">
                {formatEventInstant(event.endsAt, event.timeZone)}
              </DetailValue>
              <DetailValue label="Time zone">
                {event.timeZone?.replaceAll('_', ' ') ?? 'Not set'}
              </DetailValue>
            </DetailGroup>
            <DetailGroup icon={<MapPinIcon aria-hidden="true" />} title="Venue">
              {event.venue === undefined ? (
                <p>Not added</p>
              ) : (
                <VenueDetails venue={event.venue} />
              )}
            </DetailGroup>
            {event.status === 'published' ? (
              <DetailGroup title="Published">
                <p>{formatUpdatedAt(event.publishedAt ?? event.updatedAt)}</p>
              </DetailGroup>
            ) : (
              <DetailGroup title="Last updated">
                <p>{formatUpdatedAt(event.updatedAt)}</p>
              </DetailGroup>
            )}
          </aside>
          {event.status === 'draft' ? (
            <EventPublication
              event={event}
              mediaBusy={mediaBusy || retirementBusy || ticketTypeBusy}
              onOperationChange={setPublicationBusy}
              reload={reload}
            />
          ) : null}
          {event.status === 'draft' ? (
            <EventRetirement
              disabled={mediaBusy || publicationBusy || ticketTypeBusy}
              event={event}
              onOperationChange={setRetirementBusy}
              reload={reload}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function MediaSlot({
  alt,
  className = '',
  emptyLabel,
  media,
}: {
  alt: string;
  className?: string;
  emptyLabel?: string;
  media?: AdminEventMedia | undefined;
}) {
  if (media === undefined) {
    return (
      <div className={`event-details-media__empty ${className}`.trim()}>
        <ImageIcon aria-hidden="true" />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <figure className={`event-details-media__image ${className}`.trim()}>
      <img src={media.url} alt={alt} loading="lazy" />
    </figure>
  );
}

function DetailGroup({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section className="event-details-summary__group">
      <div className="event-details-summary__heading">
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="event-details-summary__content">{children}</div>
    </section>
  );
}

function DetailValue({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="event-details-summary__value">
      <span>{label}</span>
      <p>{children}</p>
    </div>
  );
}

function VenueDetails({ venue }: { venue: EventVenue }) {
  const country = getName(venue.countryCode) ?? venue.countryCode;
  const locality = [venue.city, venue.region, venue.postalCode]
    .filter(Boolean)
    .join(', ');

  return (
    <address>
      <strong>{venue.name}</strong>
      <span>{venue.addressLine1}</span>
      {venue.addressLine2 === undefined ? null : (
        <span>{venue.addressLine2}</span>
      )}
      <span>{locality}</span>
      <span>{country}</span>
    </address>
  );
}

function formatEventInstant(value?: string, timeZone?: string): string {
  if (value === undefined) return 'Not set';
  try {
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(new Date(value));
  } catch {
    return 'Date unavailable';
  }
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function EventDetailsLoading() {
  return (
    <main className="admin-page" aria-busy="true" aria-label="Loading event">
      <div className="event-loading__heading" />
      <div className="event-loading__panel" />
      <span className="visually-hidden">Loading event…</span>
    </main>
  );
}

function EventState({ title, retry }: { title: string; retry?: () => void }) {
  return (
    <main className="admin-page">
      <div
        className="event-page-state"
        role={retry === undefined ? undefined : 'alert'}
      >
        <WarningCircleIcon aria-hidden="true" />
        <h1>{title}</h1>
        <div>
          <Link className="button button--secondary" to="/admin">
            Back to Events
          </Link>
          {retry === undefined ? null : (
            <Button type="button" onClick={retry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
