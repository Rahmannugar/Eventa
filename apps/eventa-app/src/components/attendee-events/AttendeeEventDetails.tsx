import { ArrowLeftIcon, CalendarDotsIcon, MapPinIcon, TicketIcon } from '@phosphor-icons/react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, userFacingApiError } from '../../lib/api/api-error';
import type { AttendeeTicketCatalogue, AttendeeTicketOption, PublishedEvent } from '../../lib/attendee-events/attendee-event.types';
import { useAttendeeEvent, useAttendeeTicketCatalogue } from '../../lib/attendee-events/useAttendeeEvent';
import { EventCoverImage } from './EventCoverImage';

const EventLocationsMap = lazy(() => import('./EventLocationsMap').then((module) => ({ default: module.EventLocationsMap })));

function VenueMap({ event }: { event: PublishedEvent }) {
  const events = useMemo(() => event.venue.latitude === undefined || event.venue.longitude === undefined ? [] : [{
    eventId: event.eventId,
    title: event.title,
    latitude: event.venue.latitude,
    longitude: event.venue.longitude,
    place: `${event.venue.name}, ${event.venue.city}`,
  }], [event]);
  if (events.length === 0) return null;
  return <section className="mt-8"><h2 className="mb-4 font-[var(--serif)] text-[26px] tracking-tight">Location</h2><Suspense fallback={<div className="h-72 rounded-2xl bg-[var(--soft)]" role="status">Loading map…</div>}><EventLocationsMap events={events} label={`Map for ${event.title}`} /></Suspense></section>;
}


interface TicketChoice {
  currency: string;
  option: AttendeeTicketOption;
}

function canBuy(option: AttendeeTicketOption): boolean {
  return option.availability.salesOpen && option.availability.quantity > 0 &&
    (option.availability.status === 'available' || option.availability.status === 'eligible' || option.availability.status === 'reserved');
}

function ticketStatus(option: AttendeeTicketOption): string {
  switch (option.availability.status) {
    case 'available': return `${option.availability.quantity} available`;
    case 'eligible': return 'Your tickets are ready';
    case 'reserved': return 'Reserved for you';
    case 'waiting': return `Waitlist position ${option.availability.waitlistPosition ?? ''}`.trim();
    case 'unavailable':
      if (option.availability.salesOpen) return 'Sold out';
      return Date.parse(option.salesStartAt) > Date.now() ? 'Sales have not opened' : 'Sales closed';
  }
}

function formatPrice(minor: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / (10 ** fractionDigits));
}

function formatSchedule(event: PublishedEvent): { day: string; time: string } {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const dateOptions: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeZone: event.timeZone };
  const timeOptions: Intl.DateTimeFormatOptions = { timeStyle: 'short', timeZone: event.timeZone };
  return {
    day: new Intl.DateTimeFormat(undefined, dateOptions).format(start),
    time: `${new Intl.DateTimeFormat(undefined, timeOptions).format(start)} – ${new Intl.DateTimeFormat(undefined, timeOptions).format(end)}`,
  };
}

function TicketChoices({ catalogue, eventId }: { catalogue: AttendeeTicketCatalogue; eventId: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const choices: TicketChoice[] = catalogue.currencies.flatMap(({ currency, ticketTypes }) =>
    ticketTypes.map((option) => ({ currency, option })),
  );
  const selected = choices.find(({ option }) => option.ticketTypeId === selectedId && canBuy(option)) ??
    choices.find(({ option }) => canBuy(option));
  const maximum = selected?.option.availability.quantity ?? 1;
  const safeQuantity = Math.min(quantity, maximum);
  const checkout = selected === undefined ? null :
    `/attendee/events/${encodeURIComponent(eventId)}/checkout?ticketTypeId=${encodeURIComponent(selected.option.ticketTypeId)}&quantity=${safeQuantity}`;

  return (
    <section aria-labelledby="attendee-tickets-heading" className="rounded-[20px] border border-border bg-[var(--paper)] p-5 shadow-[0_8px_30px_rgb(23_35_29_/_4%)] sm:p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <TicketIcon aria-hidden="true" className="text-[var(--evergreen)]" size={21} />
        <h2 className="font-[var(--serif)] text-[26px] tracking-tight" id="attendee-tickets-heading">Tickets</h2>
      </div>
      {catalogue.currencies.map((group) => (
        <div className="mt-6 first:mt-0" key={group.currency}>
          {catalogue.currencies.length > 1 && <h3 className="mb-2.5 text-xs font-bold tracking-wider text-[var(--muted)] uppercase">Prices in {group.currency}</h3>}
          {group.ticketTypes.map((option) => {
            const available = canBuy(option);
            const selectedOption = selected?.option.ticketTypeId === option.ticketTypeId;
            return (
              <label className={`my-2 flex min-h-[76px] cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] ${selectedOption ? 'border-[var(--evergreen)] bg-[var(--soft)]' : 'border-border hover:border-[var(--evergreen)]'} ${available ? '' : 'cursor-default opacity-70'}`} key={option.ticketTypeId}>
                <input
                  checked={selectedOption}
                  disabled={!available}
                  name="ticket-type"
                  onChange={() => { setSelectedId(option.ticketTypeId); setQuantity(1); }}
                  type="radio"
                  value={option.ticketTypeId}
                  className="mt-1 size-[17px] shrink-0 accent-[var(--evergreen)]"
                />
                <span className="grid min-w-0 flex-1 gap-1">
                  <strong className="text-[15px]">{option.name}</strong>
                  {option.description && <span className="text-xs leading-normal text-[var(--muted)]">{option.description}</span>}
                  <small className="text-xs leading-normal text-[var(--muted)]">{ticketStatus(option)}</small>
                </span>
                <strong className="shrink-0 whitespace-nowrap text-sm">{formatPrice(option.priceMinor, group.currency)}</strong>
              </label>
            );
          })}
        </div>
      ))}
      {selected ? (
        <div className="mt-5 grid grid-cols-[auto_1fr] items-center gap-3.5 border-t border-border pt-5">
          <label className="text-sm font-semibold" htmlFor="attendee-ticket-quantity">Quantity</label>
          <input
            id="attendee-ticket-quantity"
            max={maximum}
            min={1}
            onChange={(input) => {
              const next = Number(input.target.value);
              if (Number.isInteger(next)) setQuantity(Math.min(Math.max(next, 1), maximum));
            }}
            type="number"
            value={safeQuantity}
            className="min-h-11 w-[75px] rounded-lg border border-border bg-[var(--paper)] px-2.5 py-2"
          />
          <span className="col-span-full text-right font-bold">
            {formatPrice(selected.option.priceMinor * safeQuantity, selected.currency)} total
          </span>
          <Link className="col-span-full flex min-h-12 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 text-center font-bold text-white no-underline hover:opacity-90 dark:text-[#0d1512]" to={checkout ?? '#'}>Continue to checkout</Link>
        </div>
      ) : (
        <p className="text-sm leading-normal text-[var(--muted)]">No tickets are available to buy right now.</p>
      )}
    </section>
  );
}

export function AttendeeEventDetails({ eventId }: { eventId: string }) {
  const eventQuery = useAttendeeEvent(eventId);
  const ticketQuery = useAttendeeTicketCatalogue(eventId, eventQuery.isSuccess);

  if (eventQuery.isPending) return <div className="mx-auto my-20 grid max-w-[600px] justify-items-start gap-3 rounded-[18px] border border-border bg-[var(--paper)] p-9" role="status">Loading event…</div>;
  if (eventQuery.isError) {
    const missing = eventQuery.error instanceof ApiError && eventQuery.error.statusCode === 404;
    return (
      <div className="mx-auto my-20 grid max-w-[600px] justify-items-start gap-3 rounded-[18px] border border-border bg-[var(--paper)] p-9" role="alert">
        <h1 className="font-[var(--serif)] text-3xl">{missing ? 'Event not found' : 'Could not load this event'}</h1>
        <p className="leading-normal text-[var(--muted)]">{missing ? 'This event may no longer be available.' : userFacingApiError(eventQuery.error)}</p>
        {missing ? <Link className="inline-flex min-h-11 items-center font-bold text-[var(--evergreen)] underline" to="/attendee/search">Find events</Link> : <button className="min-h-11 font-bold text-[var(--evergreen)] underline" onClick={() => void eventQuery.refetch()} type="button">Try again</button>}
      </div>
    );
  }

  const event = eventQuery.data;
  const cover = event.media.find((media) => media.slot === 'cover');
  const gallery = event.media.filter((media) => media.slot !== 'cover');
  const schedule = formatSchedule(event);
  const location = [event.venue.addressLine1, event.venue.addressLine2, event.venue.city, event.venue.region, event.venue.countryCode].filter(Boolean).join(', ');

  return (
    <div className="mx-auto w-full max-w-[1190px] px-4 pt-4 pb-14 sm:px-7 sm:pt-6 sm:pb-20">
      <Link className="mb-4 inline-flex min-h-11 items-center gap-2 font-semibold text-[var(--evergreen)] no-underline hover:underline" to="/attendee/search"><ArrowLeftIcon aria-hidden="true" size={17} /> Find events</Link>
      <EventCoverImage className="block h-[clamp(220px,28vw,340px)] w-full rounded-[20px] object-cover max-sm:h-60 max-sm:rounded-[14px]" src={cover?.url} />
      <div className="grid grid-cols-1 items-start gap-8 pt-6 min-[1320px]:grid-cols-[minmax(0,1.35fr)_minmax(310px,.8fr)] min-[1320px]:gap-10 min-[1320px]:pt-[30px]">
        <article className="min-w-0">
          <h1 className="mt-2.5 mb-6 max-w-[780px] font-[var(--serif)] text-[clamp(34px,3.2vw,50px)] leading-[1.12] tracking-[-.035em] break-words">{event.title}</h1>
          <div className="mb-6 flex flex-wrap gap-2">{event.categories.map((category) => <span className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-1 text-xs font-semibold text-[var(--muted)]" key={category}>{category}</span>)}</div>
          <div className="grid gap-[18px] border-y border-border py-6">
            <div className="flex items-start gap-3.5"><CalendarDotsIcon aria-hidden="true" className="mt-1 shrink-0 text-[var(--evergreen)]" size={21} /><span className="grid gap-1"><strong>{schedule.day}</strong><small className="text-sm leading-normal text-[var(--muted)]">{schedule.time}</small></span></div>
            <div className="flex items-start gap-3.5"><MapPinIcon aria-hidden="true" className="mt-1 shrink-0 text-[var(--evergreen)]" size={21} /><span className="grid gap-1"><strong>{event.venue.name}</strong><small className="text-sm leading-normal text-[var(--muted)]">{location}</small></span></div>
          </div>
          <section className="mt-8">
            <h2 className="font-[var(--serif)] text-[26px] tracking-tight">About this event</h2>
            <p className="mt-3.5 max-w-[70ch] text-base leading-7 whitespace-pre-line">{event.description}</p>
          </section>
          <VenueMap event={event} />
          {gallery.length > 0 && <div className="mt-7 grid grid-cols-2 gap-2.5">{gallery.map((media) => <img alt="" className="h-[130px] w-full rounded-xl object-cover sm:h-[180px]" key={media.mediaId} loading="lazy" src={media.url} />)}</div>}
        </article>
        <aside className="min-w-0 min-[1320px]:sticky min-[1320px]:top-6">
          {ticketQuery.isPending ? <div className="rounded-[20px] border border-border bg-[var(--paper)] p-6" role="status">Loading tickets…</div> :
            ticketQuery.isError ? <div className="rounded-[20px] border border-border bg-[var(--paper)] p-6" role="alert"><p className="text-[var(--muted)]">{userFacingApiError(ticketQuery.error)}</p><button className="min-h-11 font-bold text-[var(--evergreen)] underline" onClick={() => void ticketQuery.refetch()} type="button">Try again</button></div> :
              <TicketChoices catalogue={ticketQuery.data} eventId={eventId} />}
        </aside>
      </div>
    </div>
  );
}
