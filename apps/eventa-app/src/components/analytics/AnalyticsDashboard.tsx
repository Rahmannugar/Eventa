import {
  ChartLineUpIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useState } from 'react';

import { isSessionInvalid } from '../../lib/api/api-error';
import type {
  AnalyticsListCriteria,
  AnalyticsStatusFilter,
  CurrencyTotals,
  EventPerformance,
} from '../../lib/analytics/analytics.types';
import {
  useAnalyticsSummary,
  useEventPerformanceList,
} from '../../lib/analytics/useAnalytics';
import { Button } from '../ui/Button';
import { statusBadge } from '../events/adminStyles';

const PAGE_SIZE = 25;

export function AnalyticsDashboard() {
  const location = useLocation();
  const [status, setStatus] = useState<AnalyticsStatusFilter>('');
  const [offset, setOffset] = useState(0);
  const criteria: AnalyticsListCriteria = {
    limit: PAGE_SIZE,
    offset,
    status,
  };
  const summary = useAnalyticsSummary();
  const list = useEventPerformanceList(criteria);

  const sessionFailed =
    (summary.error !== null && isSessionInvalid(summary.error)) ||
    (list.error !== null && isSessionInvalid(list.error));
  if (sessionFailed) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  const events = list.data?.events ?? [];
  const total = list.data?.total ?? 0;
  const summaryFailed = summary.error !== null;
  const listFailed = list.error !== null && events.length === 0;

  function changeStatus(next: AnalyticsStatusFilter) {
    setStatus(next);
    setOffset(0);
  }

  return (
    <main className="mx-auto w-full max-w-[94rem] px-[clamp(1rem,4vw,3rem)] py-[clamp(2rem,5vw,4.5rem)] max-[560px]:px-4 max-[560px]:py-6">
      <header className="border-b border-[var(--line)] pb-[clamp(2rem,4vw,3rem)]">
        <h1 className="font-[var(--serif)] text-[clamp(2.65rem,7vw,4.6rem)] font-medium leading-none tracking-[-.055em]">Analytics</h1>
      </header>

      {summary.isPending ? (
        <AnalyticsSummaryLoading />
      ) : summaryFailed ? (
        <AnalyticsError
          label="Portfolio totals could not be loaded."
          retry={() => void summary.refetch()}
        />
      ) : (
        <AnalyticsSummary
          revenue={summary.data.revenue}
          eventsCancelled={summary.data.eventsCancelled}
          eventsPublished={summary.data.eventsPublished}
          ticketsCheckedIn={summary.data.ticketsCheckedIn}
          ticketsRevoked={summary.data.ticketsRevoked}
        />
      )}

      <section className="mt-8 grid gap-3" aria-label="Event performance">
        <div className="flex flex-col justify-between gap-4 min-[961px]:flex-row min-[961px]:items-end">
          <h2 className="font-[var(--serif)] text-[1.35rem]">Event performance</h2>
          <div className="grid gap-1.5 text-sm">
            <label className="text-xs font-bold text-[var(--muted)]" htmlFor="analytics-status-filter">Status</label>
            <select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[var(--ink)]"
              id="analytics-status-filter"
              value={status}
              onChange={(event) =>
                changeStatus(event.target.value as AnalyticsStatusFilter)
              }
            >
              <option value="">All events</option>
              <option value="published">Published</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {list.isPending ? (
          <AnalyticsTableLoading />
        ) : listFailed ? (
          <AnalyticsError
            label="Event performance could not be loaded."
            retry={() => void list.refetch()}
          />
        ) : events.length === 0 ? (
          <AnalyticsEmpty
            filtered={status !== ''}
            clear={() => changeStatus('')}
          />
        ) : (
          <>
            {list.error === null ? null : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-700/30 bg-[var(--danger-soft)] px-4 py-3 text-[var(--danger)]" role="alert">
                More rows could not be loaded.
                <Button
                  variant="quiet"
                  type="button"
                  onClick={() => void list.refetch()}
                >
                  Try again
                </Button>
              </div>
            )}
            <div
              className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
              aria-label="Event performance"
              aria-busy={list.isFetching}
            >
              <div className="grid min-w-[52rem] grid-cols-[minmax(11rem,1.3fr)_7rem_6.5rem_6.5rem_minmax(6rem,.8fr)_minmax(6rem,.8fr)_minmax(6rem,.8fr)_7rem] items-center gap-3 border-b border-[var(--line)] bg-[var(--soft)] px-4 py-3 text-[11px] font-extrabold tracking-wide text-[var(--muted)] uppercase" aria-hidden="true">
                <span>Event</span>
                <span>Status</span>
                <span>Tickets sold</span>
                <span>Checked in</span>
                <span>Gross</span>
                <span>Refunded</span>
                <span>Net</span>
                <span>Updated</span>
              </div>
              {events.map((event) => (
                <AnalyticsRow event={event} key={event.eventId} />
              ))}
            </div>
            <nav
              className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]"
              aria-label="Event performance pages"
            >
              <Button
                type="button"
                variant="secondary"
                disabled={offset === 0 || list.isFetching}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <span aria-live="polite">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <Button
                type="button"
                variant="secondary"
                disabled={offset + PAGE_SIZE >= total || list.isFetching}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </section>
    </main>
  );
}

function AnalyticsSummary({
  eventsCancelled,
  eventsPublished,
  revenue,
  ticketsCheckedIn,
  ticketsRevoked,
}: {
  eventsCancelled: number;
  eventsPublished: number;
  revenue: CurrencyTotals[];
  ticketsCheckedIn: number;
  ticketsRevoked: number;
}) {
  return (
    <section className="mt-6 grid gap-4" aria-label="Portfolio summary">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4">
        <SummaryCard label="Events published" value={eventsPublished} />
        <SummaryCard label="Events cancelled" value={eventsCancelled} />
        <SummaryCard label="Tickets checked in" value={ticketsCheckedIn} />
        <SummaryCard label="Tickets revoked" value={ticketsRevoked} />
      </div>
      {revenue.length === 0 ? (
        <p className="text-[var(--muted)]">
          Revenue appears here once tickets sell.
        </p>
      ) : (
        <div className="grid gap-3">
          {revenue.map((totals) => (
            <RevenueRow totals={totals} key={totals.currency} />
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 py-4 shadow-[0_10px_35px_rgb(23_35_29_/_4%)]">
      <span className="text-xs font-extrabold tracking-wide text-[var(--muted)] uppercase">{label}</span>
      <strong className="font-[var(--serif)] text-[1.7rem]">{value.toLocaleString('en')}</strong>
    </div>
  );
}

function RevenueRow({ totals }: { totals: CurrencyTotals }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3 rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 py-4 [&_small]:text-[11px] [&_small]:font-extrabold [&_small]:tracking-wide [&_small]:text-[var(--muted)] [&_small]:uppercase [&_span]:grid [&_span]:gap-0.5">
      <strong className="font-[var(--serif)] text-lg">{totals.currency}</strong>
      <span>
        <small>Gross</small>
        {formatMoney(totals.grossRevenueMinor, totals.currency)}
      </span>
      <span>
        <small>Refunded</small>
        {formatMoney(totals.refundedRevenueMinor, totals.currency)}
      </span>
      <span>
        <small>Net</small>
        {formatMoney(totals.netRevenueMinor, totals.currency)}
      </span>
      <span>
        <small>Tickets sold</small>
        {totals.ticketsSold.toLocaleString('en')}
      </span>
      <span>
        <small>Tickets refunded</small>
        {totals.ticketsRefunded.toLocaleString('en')}
      </span>
    </div>
  );
}

function AnalyticsRow({ event }: { event: EventPerformance }) {
  return (
    <div className="grid min-w-[52rem] grid-cols-[minmax(11rem,1.3fr)_7rem_6.5rem_6.5rem_minmax(6rem,.8fr)_minmax(6rem,.8fr)_minmax(6rem,.8fr)_7rem] items-center gap-3 border-b border-[var(--line)] px-4 py-3 text-sm last:border-0">
      <Link
        className="truncate font-semibold text-[var(--evergreen)] hover:underline"
        to={`/admin/events/${event.eventId}`}
      >
        {event.eventId}
      </Link>
      <span className={statusBadge(event.status)}>
        {event.status === 'cancelled' ? 'Cancelled' : 'Published'}
      </span>
      <span>{event.ticketsSold.toLocaleString('en')}</span>
      <span>{event.ticketsCheckedIn.toLocaleString('en')}</span>
      <span>{formatMoney(event.grossRevenueMinor, event.currency)}</span>
      <span>{formatMoney(event.refundedRevenueMinor, event.currency)}</span>
      <span>{formatMoney(event.netRevenueMinor, event.currency)}</span>
      <span>{formatUpdatedAt(event.updatedAt)}</span>
    </div>
  );
}

function AnalyticsError({
  label,
  retry,
}: {
  label: string;
  retry: () => void;
}) {
  return (
    <section className="mt-6 grid justify-items-center rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-4 py-[clamp(3rem,8vw,6rem)] text-center" role="alert">
      <WarningCircleIcon className="size-8 text-[var(--evergreen)]" aria-hidden="true" />
      <h2 className="my-4 font-[var(--serif)] text-[1.7rem]">Analytics could not be loaded</h2>
      <p className="mb-4 max-w-[30rem] text-sm text-[var(--muted)]">{label}</p>
      <Button type="button" variant="secondary" onClick={retry}>
        Try again
      </Button>
    </section>
  );
}

function AnalyticsEmpty({
  clear,
  filtered,
}: {
  clear: () => void;
  filtered: boolean;
}) {
  return (
    <section className="mt-6 grid justify-items-center rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-4 py-[clamp(3rem,8vw,6rem)] text-center">
      <ChartLineUpIcon className="size-8 text-[var(--evergreen)]" aria-hidden="true" />
      <h2 className="my-4 font-[var(--serif)] text-[1.7rem]">{filtered ? 'No events match this filter' : 'No performance data yet'}</h2>
      {filtered ? (
        <Button type="button" variant="secondary" onClick={clear}>
          Show all events
        </Button>
      ) : (
        <p className="max-w-[30rem] text-sm text-[var(--muted)]">Numbers appear here after events are published and tickets sell.</p>
      )}
    </section>
  );
}

function AnalyticsSummaryLoading() {
  return (
    <div
      className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4"
      aria-busy="true"
      aria-label="Loading portfolio summary"
    >
      {[0, 1, 2, 3].map((item) => (
        <div className="min-h-20 animate-pulse rounded-2xl border border-[var(--line)] bg-[var(--soft)]" key={item} />
      ))}
      <span className="sr-only">Loading portfolio summary…</span>
    </div>
  );
}

function AnalyticsTableLoading() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)]"
      aria-busy="true"
      aria-label="Loading event performance"
    >
      {[0, 1, 2, 3].map((item) => (
        <div className="min-h-12 animate-pulse border-b border-[var(--line)] bg-[var(--soft)] last:border-0" key={item} />
      ))}
      <span className="sr-only">Loading event performance…</span>
    </div>
  );
}

function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', {
      currency,
      style: 'currency',
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
    new Date(value),
  );
}
