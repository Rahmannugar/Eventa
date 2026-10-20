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
    <main className="admin-page admin-page--analytics">
      <header className="admin-page__header">
        <h1>Analytics</h1>
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

      <section className="analytics-performance" aria-label="Event performance">
        <div className="analytics-performance__controls">
          <h2>Event performance</h2>
          <div className="field">
            <label htmlFor="analytics-status-filter">Status</label>
            <select
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
              <div className="analytics-performance__load-error" role="alert">
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
              className="analytics-table"
              aria-label="Event performance"
              aria-busy={list.isFetching}
            >
              <div className="analytics-table__head" aria-hidden="true">
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
              className="analytics-table__pagination"
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
    <section className="analytics-summary" aria-label="Portfolio summary">
      <div className="analytics-summary__cards">
        <SummaryCard label="Events published" value={eventsPublished} />
        <SummaryCard label="Events cancelled" value={eventsCancelled} />
        <SummaryCard label="Tickets checked in" value={ticketsCheckedIn} />
        <SummaryCard label="Tickets revoked" value={ticketsRevoked} />
      </div>
      {revenue.length === 0 ? (
        <p className="analytics-summary__empty">
          Revenue appears here once tickets sell.
        </p>
      ) : (
        <div className="analytics-summary__revenue">
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
    <div className="analytics-summary__card">
      <span>{label}</span>
      <strong>{value.toLocaleString('en')}</strong>
    </div>
  );
}

function RevenueRow({ totals }: { totals: CurrencyTotals }) {
  return (
    <div className="analytics-summary__currency">
      <strong>{totals.currency}</strong>
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
    <div className="analytics-table__row">
      <Link
        className="analytics-table__event"
        to={`/admin/events/${event.eventId}`}
      >
        {event.eventId}
      </Link>
      <span className={`status-badge status-badge--${event.status}`}>
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
    <section className="event-list-state" role="alert">
      <WarningCircleIcon aria-hidden="true" />
      <h2>Analytics could not be loaded</h2>
      <p>{label}</p>
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
    <section className="event-list-state">
      <ChartLineUpIcon aria-hidden="true" />
      <h2>{filtered ? 'No events match this filter' : 'No performance data yet'}</h2>
      {filtered ? (
        <Button type="button" variant="secondary" onClick={clear}>
          Show all events
        </Button>
      ) : (
        <p>Numbers appear here after events are published and tickets sell.</p>
      )}
    </section>
  );
}

function AnalyticsSummaryLoading() {
  return (
    <div
      className="analytics-summary__cards analytics-summary__cards--loading"
      aria-busy="true"
      aria-label="Loading portfolio summary"
    >
      {[0, 1, 2, 3].map((item) => (
        <div className="analytics-summary__skeleton" key={item} />
      ))}
      <span className="visually-hidden">Loading portfolio summary…</span>
    </div>
  );
}

function AnalyticsTableLoading() {
  return (
    <div
      className="analytics-table analytics-table--loading"
      aria-busy="true"
      aria-label="Loading event performance"
    >
      {[0, 1, 2, 3].map((item) => (
        <div className="analytics-table__skeleton" key={item} />
      ))}
      <span className="visually-hidden">Loading event performance…</span>
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
