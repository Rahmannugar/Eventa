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
import { EventCancellation } from './EventCancellation';
import { EventMediaManager } from './EventMediaManager';
import { EventPublication } from './EventPublication';
import { EventRetirement } from './EventRetirement';
import { EventTicketTypes } from './EventTicketTypes';
import { adminPage, backLink, statusBadge } from './adminStyles';

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
    <main className={adminPage}>
      <header className="border-b border-[var(--line)] pb-[clamp(1.5rem,4vw,2.25rem)]">
        <Link className={backLink} to="/admin">
          <ArrowLeftIcon aria-hidden="true" />
          Events
        </Link>
        <div className="flex flex-col items-stretch justify-between gap-6 min-[600px]:flex-row min-[600px]:items-end">
          <div>
            <div className="flex">
              <span className={statusBadge(event.status)}>
                {event.status === 'draft'
                  ? 'Draft'
                  : event.status === 'cancelled'
                    ? 'Cancelled'
                    : 'Published'}
              </span>
            </div>
            <h1 className="mt-3 max-w-[54rem] wrap-anywhere font-[family-name:var(--serif)] text-[clamp(2.4rem,7vw,4.5rem)] font-medium leading-none tracking-[-.055em]">{event.title}</h1>
          </div>
          {event.status === 'draft' ? (
            <Link
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--evergreen)] px-4 py-3 text-sm font-bold text-white no-underline hover:bg-[var(--evergreen-deep)] min-[600px]:w-auto"
              to={`/admin/events/${event.eventId}/edit`}
            >
              <NotePencilIcon aria-hidden="true" />
              Edit event
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-[clamp(1.25rem,3vw,2rem)] pt-[clamp(1.5rem,4vw,2.5rem)] min-[1100px]:grid-cols-[minmax(0,1fr)_20rem] min-[1100px]:items-start">
        <div className="grid min-w-0 gap-5">
          <section
            className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
            aria-labelledby="about-title"
          >
            <div className="border-b border-[var(--line)] px-[clamp(1rem,3vw,1.4rem)] py-4">
              <h2 className="text-sm font-semibold" id="about-title">About</h2>
            </div>
            <div className="grid gap-5 p-[clamp(1rem,3vw,1.4rem)]">
              <p className="max-w-[66ch] whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">{event.description ?? 'No description added.'}</p>
              <div className="flex flex-wrap gap-2" aria-label="Categories">
                {event.categories.map((category) => (
                  <span className="rounded-full bg-[var(--soft)] px-2.5 py-1.5 text-xs font-bold text-[var(--evergreen-deep)]" key={category}>{category}</span>
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
            className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
            aria-labelledby="media-title"
          >
            <div className="border-b border-[var(--line)] px-[clamp(1rem,3vw,1.4rem)] py-4">
              <h2 className="text-sm font-semibold" id="media-title">Images</h2>
            </div>
            <div className="grid gap-3 p-[clamp(1rem,3vw,1.4rem)]">
              {event.status === 'draft' ? (
                <EventMediaManager
                  disabled={publicationBusy || retirementBusy || ticketTypeBusy}
                  event={event}
                  onOperationChange={setMediaBusy}
                />
              ) : (
                <>
                  <MediaSlot
                    className="aspect-[16/7] min-h-40"
                    media={cover}
                    emptyLabel="No cover image"
                    alt={cover === undefined ? '' : `${event.title} cover`}
                  />
                  <div className="grid gap-3 min-[600px]:grid-cols-2" aria-label="Gallery">
                    {gallery.length === 0 ? (
                      <div className="grid min-h-40 content-center justify-items-center gap-2 rounded-xl border border-dashed border-[var(--line)] bg-[var(--soft)] text-xs font-bold text-[var(--muted)]">
                        <ImageIcon aria-hidden="true" className="size-6 text-[var(--evergreen)]" />
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

        <div className="grid gap-4 min-[1100px]:sticky min-[1100px]:top-8">
          <aside className="h-fit overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)]" aria-label="Event summary">
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
            ) : event.status === 'cancelled' ? (
              <DetailGroup title="Cancelled">
                <p>{formatUpdatedAt(event.cancelledAt ?? event.updatedAt)}</p>
              </DetailGroup>
            ) : (
              <DetailGroup title="Last updated">
                <p>{formatUpdatedAt(event.updatedAt)}</p>
              </DetailGroup>
            )}
          </aside>
          {event.status === 'published' ? (
            <EventCancellation
              event={event}
              mediaBusy={mediaBusy || retirementBusy || ticketTypeBusy}
              onOperationChange={setPublicationBusy}
              reload={reload}
            />
          ) : null}
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
      <div className={`grid min-h-40 content-center justify-items-center gap-2 rounded-xl border border-dashed border-[var(--line)] bg-[var(--soft)] text-xs font-bold text-[var(--muted)] ${className}`.trim()}>
        <ImageIcon aria-hidden="true" className="size-6 text-[var(--evergreen)]" />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <figure className={`min-h-40 overflow-hidden rounded-xl bg-[var(--soft)] ${className}`.trim()}>
      <img className="h-full w-full object-cover" src={media.url} alt={alt} loading="lazy" />
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
    <section className="border-b border-[var(--line)] p-4 last:border-b-0">
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-[var(--evergreen)]">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="mt-3 grid gap-3 text-xs leading-relaxed text-[var(--ink)] [&_address]:grid [&_address]:gap-1 [&_address]:not-italic">{children}</div>
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
    <div className="grid gap-1">
      <span className="text-[.65rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">{label}</span>
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
    <main className={adminPage} aria-busy="true" aria-label="Loading event">
      <div className="h-28 w-[min(70%,34rem)] animate-pulse rounded-2xl bg-[var(--soft)] motion-reduce:animate-none" />
      <div className="mt-8 min-h-[33rem] animate-pulse rounded-2xl bg-[var(--soft)] motion-reduce:animate-none" />
      <span className="sr-only">Loading event…</span>
    </main>
  );
}

function EventState({ title, retry }: { title: string; retry?: () => void }) {
  return (
    <main className={adminPage}>
      <div
        className="mx-auto my-[clamp(3rem,10vw,8rem)] grid w-full max-w-xl justify-items-center text-center"
        role={retry === undefined ? undefined : 'alert'}
      >
        <WarningCircleIcon aria-hidden="true" className="size-10 text-[var(--persimmon)]" />
        <h1 className="mt-4 font-[family-name:var(--serif)] text-[clamp(2rem,6vw,3rem)] tracking-tight">{title}</h1>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-sm font-bold text-[var(--ink)] no-underline hover:bg-[var(--soft)]" to="/admin">
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
