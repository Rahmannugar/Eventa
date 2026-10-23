import { TicketIcon } from '@phosphor-icons/react';
import QRCode from 'react-qr-code';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { userFacingApiError } from '../lib/api/api-error';
import { usePublishedEvent } from '../lib/attendee-events/useAttendeeEvent';
import { useSession } from '../lib/auth/useAuth';
import { useAttendeeTickets } from '../lib/tickets/useAttendeeTickets';
import type { AttendeeTicket } from '../lib/tickets/ticket.types';


function TicketCard({ ticket }: { ticket: AttendeeTicket }) {
  const event = usePublishedEvent(ticket.eventId);
  const title = event.data?.title ?? 'Event details unavailable';
  const status = ticket.status === 'issued' ? 'Ready' : ticket.status === 'checked_in' ? 'Used' : 'Cancelled';

  return (
    <article className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-border bg-[var(--paper)] p-6 sm:flex-row">
      <div className="min-w-0">
        <h2 className="my-2 font-[var(--serif)] text-2xl">{event.data ? <Link className="hover:underline" to={`/attendee/events/${ticket.eventId}`}>{title}</Link> : title}</h2>
        {event.data ? <p className="mb-3 text-sm text-[var(--muted)]">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.data.timeZone }).format(new Date(event.data.startsAt))}</p> : null}
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${ticket.status === 'issued' ? 'bg-[#e4f3e9] text-[#176044] dark:bg-[#173a2c] dark:text-[#9fe8bd]' : ticket.status === 'checked_in' ? 'bg-[#edf0f2] text-[#59636b] dark:bg-[#253330] dark:text-[#b5c4bc]' : 'bg-[#fff0ec] text-[#a14431] dark:bg-[#402823] dark:text-[#ffaaa0]'}`}>{status}</span>
      </div>
      {ticket.status === 'issued' ? (
        <details className="shrink-0">
          <summary className="cursor-pointer text-sm font-bold text-[var(--evergreen)]">Show ticket code</summary>
          <div className="mt-4 w-fit rounded-lg border border-border bg-white p-3">
            <QRCode value={ticket.qrToken} size={184} aria-label={`Ticket code for ${title}`} />
          </div>
          <p className="mt-2 max-w-52 text-xs text-[var(--muted)]">Show this code at the event entrance.</p>
        </details>
      ) : null}
    </article>
  );
}

export function AttendeeTicketsPage() {
  const [searchParams] = useSearchParams();
  const awaitingOrderId = searchParams.get('orderId') ?? undefined;
  const [pollUntil] = useState(() => Date.now() + 60_000);
  const [waitingLonger, setWaitingLonger] = useState(false);
  useEffect(() => {
    if (awaitingOrderId === undefined) return;
    const timer = window.setTimeout(() => setWaitingLonger(true), 60_000);
    return () => window.clearTimeout(timer);
  }, [awaitingOrderId]);
  const session = useSession('attendee');
  const attendeeId = session.data?.actor === 'attendee' ? session.data.attendeeId : '';
  const tickets = useAttendeeTickets(attendeeId, awaitingOrderId, pollUntil);
  const records = tickets.data?.pages.flatMap((page) => page.tickets) ?? [];
  const awaitingTicket = awaitingOrderId !== undefined && !records.some((ticket) => ticket.orderId === awaitingOrderId);

  return (
    <div className="mx-auto w-full max-w-[1190px] px-4 py-7 sm:px-7 sm:py-10">
      <header>
        <div>
          <h1 className="font-[var(--serif)] text-[clamp(2.1rem,4vw,3rem)] tracking-tight">My tickets</h1>
          <p className="mt-2 leading-normal text-[var(--muted)]">Your tickets are here once an order is paid and the tickets have been issued.</p>
        </div>
      </header>

      {tickets.isPending ? <div className="mt-8 rounded-2xl border border-border bg-[var(--paper)] p-8" role="status">Loading your tickets…</div> : null}
      {tickets.isError ? (
        <div className="mt-8 rounded-2xl border border-border bg-[var(--paper)] p-8" role="alert">
          <p>{userFacingApiError(tickets.error)}</p>
          <button className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-[var(--evergreen)] px-4 text-sm font-bold text-white dark:text-[#0d1512]" onClick={() => { void tickets.refetch(); }} type="button">Try again</button>
        </div>
      ) : null}
      {tickets.isSuccess && awaitingTicket ? (
        <div className="mt-8 rounded-2xl border border-border bg-[var(--paper)] p-8" role="status">
          <h2 className="font-[var(--serif)] text-2xl">Your booking is confirmed</h2>
          <p className="mt-2 text-[var(--muted)]">{waitingLonger ? 'Your ticket is taking longer than expected. Check again shortly.' : 'We are preparing your ticket. This page checks for it automatically.'}</p>
          <button className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--evergreen)] px-4 text-sm font-bold text-white disabled:opacity-50 dark:text-[#0d1512]" disabled={tickets.isFetching} onClick={() => { void tickets.refetch(); }} type="button">Check again</button>
        </div>
      ) : null}
      {tickets.isSuccess && records.length === 0 && !awaitingTicket ? (
        <div className="mt-8 rounded-2xl border border-border bg-[var(--paper)] p-8 text-center">
          <TicketIcon aria-hidden="true" className="mx-auto size-10 text-[var(--evergreen)]" />
          <h2 className="mt-3 font-[var(--serif)] text-2xl">No tickets yet</h2>
          <p className="mt-2 text-[var(--muted)]">When you get tickets for an event, you will find them here.</p>
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--evergreen)] px-4 text-sm font-bold text-white no-underline dark:text-[#0d1512]" to="/attendee/search">Find events</Link>
        </div>
      ) : null}
      {records.length > 0 ? <div className="mt-8 grid gap-4">{records.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}</div> : null}
      {tickets.hasNextPage ? (
        <button className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[var(--evergreen)] px-4 text-sm font-bold text-white disabled:opacity-50 dark:text-[#0d1512]" disabled={tickets.isFetchingNextPage} onClick={() => { void tickets.fetchNextPage(); }} type="button">
          {tickets.isFetchingNextPage ? 'Loading…' : 'Show more tickets'}
        </button>
      ) : null}
    </div>
  );
}
