import { runWithOperationSpan } from '@eventa/observability';
import { Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { EVENT_WAITLIST_ACTIVE_LIMIT } from '../constants/event.constants';
import type {
  AttendeeEventTicketCatalogueRecord,
  AttendeeEventTicketTypeRecord,
  EventTicketAvailabilityRepository as EventTicketAvailabilityRepositoryPort,
} from '../types/event.types';

type DatabaseTimestamp = Date | string;

interface CatalogueRow extends Record<string, unknown> {
  eventId: string;
  ticketCurrencyId: string;
  currency: string;
  currencyCreatedAt: DatabaseTimestamp;
  currencyUpdatedAt: DatabaseTimestamp;
  ticketTypeId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  capacity: number;
  reservedQuantity: number;
  soldQuantity: number;
  salesStartAt: DatabaseTimestamp;
  salesEndAt: DatabaseTimestamp;
  salesOpen: boolean;
  activeWaitlistCount: number;
  waitingCount: number;
  eligibleQuantity: number;
  attendeeWaitlistStatus: 'waiting' | 'eligible' | null;
  attendeeWaitlistQuantity: number | null;
  waitlistPosition: number | null;
  opportunityExpiresAt: DatabaseTimestamp | null;
  reservationQuantity: number;
  reservationExpiresAt: DatabaseTimestamp | null;
}

function decodeTimestamp(value: DatabaseTimestamp): Date {
  if (value instanceof Date) return value;
  const decoded = new Date(value);
  if (Number.isNaN(decoded.getTime())) {
    throw new Error('Event ticket availability returned an invalid timestamp');
  }
  return decoded;
}

function decodeNullableTimestamp(value: DatabaseTimestamp | null): Date | null {
  return value === null ? null : decodeTimestamp(value);
}

export class EventTicketAvailabilityRepository implements EventTicketAvailabilityRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE) private readonly database: EventDatabase,
  ) {}

  getCatalogue(
    eventId: string,
    attendeeId: string,
  ): Promise<AttendeeEventTicketCatalogueRecord | undefined> {
    return runWithOperationSpan(
      'event.ticket_availability.get_catalogue',
      async () => {
        const rows = await this.database.execute<CatalogueRow>(sql`
          SELECT
            e.id AS "eventId",
            c.id AS "ticketCurrencyId",
            c.currency,
            c.created_at AS "currencyCreatedAt",
            c.updated_at AS "currencyUpdatedAt",
            t.id AS "ticketTypeId",
            t.name,
            t.description,
            t.price_minor AS "priceMinor",
            t.capacity,
            t.reserved_quantity AS "reservedQuantity",
            t.sold_quantity AS "soldQuantity",
            t.sales_start_at AS "salesStartAt",
            t.sales_end_at AS "salesEndAt",
            (t.sales_start_at <= now() AND t.sales_end_at > now() AND e.starts_at > now()) AS "salesOpen",
            COALESCE(w.active_count, 0)::int AS "activeWaitlistCount",
            COALESCE(w.waiting_count, 0)::int AS "waitingCount",
            COALESCE(w.eligible_quantity, 0)::int AS "eligibleQuantity",
            aw.status AS "attendeeWaitlistStatus",
            aw.quantity AS "attendeeWaitlistQuantity",
            CASE
              WHEN aw.status = 'waiting' THEN (
                SELECT count(*)::int + 1
                FROM event_waitlist_entries q
                WHERE q.ticket_type_id = t.id
                  AND (
                    (q.status = 'eligible' AND q.opportunity_expires_at > now())
                    OR (
                      q.status = 'waiting'
                      AND (q.created_at, q.id) < (aw.created_at, aw.id)
                    )
                  )
              )
              ELSE NULL
            END AS "waitlistPosition",
            aw.opportunity_expires_at AS "opportunityExpiresAt",
            COALESCE(ar.quantity, 0)::int AS "reservationQuantity",
            ar.expires_at AS "reservationExpiresAt"
          FROM events e
          INNER JOIN event_ticket_currencies c ON c.event_id = e.id
          INNER JOIN event_ticket_types t
            ON t.ticket_currency_id = c.id
            AND t.retired_at IS NULL
          LEFT JOIN LATERAL (
            SELECT
              count(*)::int AS active_count,
              count(*) FILTER (WHERE entry.status = 'waiting')::int AS waiting_count,
              COALESCE(sum(entry.quantity) FILTER (
                WHERE entry.status = 'eligible'
                  AND entry.opportunity_expires_at > now()
              ), 0)::int AS eligible_quantity
            FROM event_waitlist_entries entry
            WHERE entry.ticket_type_id = t.id
              AND (
                entry.status = 'waiting'
                OR (
                  entry.status = 'eligible'
                  AND entry.opportunity_expires_at > now()
                )
              )
          ) w ON true
          LEFT JOIN LATERAL (
            SELECT entry.id, entry.status, entry.quantity, entry.created_at,
              entry.opportunity_expires_at
            FROM event_waitlist_entries entry
            WHERE entry.ticket_type_id = t.id
              AND entry.attendee_id = ${attendeeId}
              AND (
                entry.status = 'waiting'
                OR (
                  entry.status = 'eligible'
                  AND entry.opportunity_expires_at > now()
                )
              )
            LIMIT 1
          ) aw ON true
          LEFT JOIN LATERAL (
            SELECT sum(reservation.quantity)::int AS quantity,
              min(reservation.expires_at) AS expires_at
            FROM event_capacity_reservations reservation
            WHERE reservation.ticket_type_id = t.id
              AND reservation.attendee_id = ${attendeeId}
              AND reservation.status = 'active'
              AND reservation.expires_at > now()
          ) ar ON true
          WHERE e.id = ${eventId}
            AND e.status = 'published'
            AND e.retired_at IS NULL
          ORDER BY c.created_at, c.id, t.created_at, t.id
        `);
        if (rows.length === 0) return undefined;

        const currencies = new Map<
          string,
          AttendeeEventTicketCatalogueRecord['ticketCurrencies'][number]
        >();
        const ticketTypes: AttendeeEventTicketTypeRecord[] = [];
        for (const row of rows) {
          currencies.set(row.ticketCurrencyId, {
            ticketCurrencyId: row.ticketCurrencyId,
            eventId: row.eventId,
            currency: row.currency,
            createdAt: decodeTimestamp(row.currencyCreatedAt),
            updatedAt: decodeTimestamp(row.currencyUpdatedAt),
          });
          ticketTypes.push(this.toTicketType(row));
        }
        return {
          eventId: rows[0]!.eventId,
          ticketCurrencies: [...currencies.values()],
          ticketTypes,
        };
      },
      {
        attributes: {
          'db.collection.name': 'event_ticket_types',
          'db.namespace': 'eventa_event',
          'db.operation.name': 'SELECT',
          'db.system.name': 'postgresql',
        },
        kind: 'client',
      },
    );
  }

  private toTicketType(row: CatalogueRow): AttendeeEventTicketTypeRecord {
    const physicalAvailable = Math.max(
      0,
      row.capacity - row.reservedQuantity - row.soldQuantity,
    );
    const publicAvailable =
      row.waitingCount > 0
        ? 0
        : Math.max(0, physicalAvailable - row.eligibleQuantity);
    const hasReservation = row.reservationQuantity > 0;
    const isEligible =
      row.salesOpen && row.attendeeWaitlistStatus === 'eligible';
    const isWaiting = row.salesOpen && row.attendeeWaitlistStatus === 'waiting';
    const availabilityStatus = hasReservation
      ? ('reserved' as const)
      : isEligible
        ? ('eligible' as const)
        : isWaiting
          ? ('waiting' as const)
          : row.salesOpen && publicAvailable > 0
            ? ('available' as const)
            : ('unavailable' as const);
    const availableQuantity = hasReservation
      ? row.reservationQuantity
      : isEligible
        ? (row.attendeeWaitlistQuantity ?? 0)
        : availabilityStatus === 'available'
          ? publicAvailable
          : 0;

    return {
      ticketTypeId: row.ticketTypeId,
      eventId: row.eventId,
      ticketCurrencyId: row.ticketCurrencyId,
      name: row.name,
      description: row.description,
      priceMinor: row.priceMinor,
      salesStartAt: decodeTimestamp(row.salesStartAt),
      salesEndAt: decodeTimestamp(row.salesEndAt),
      salesOpen: row.salesOpen,
      availabilityStatus,
      availableQuantity,
      canJoinWaitlist:
        row.salesOpen &&
        !hasReservation &&
        !isEligible &&
        !isWaiting &&
        row.activeWaitlistCount < EVENT_WAITLIST_ACTIVE_LIMIT &&
        publicAvailable === 0,
      waitlistPosition: isWaiting ? row.waitlistPosition : null,
      opportunityExpiresAt: isEligible
        ? decodeNullableTimestamp(row.opportunityExpiresAt)
        : null,
      reservationExpiresAt: hasReservation
        ? decodeNullableTimestamp(row.reservationExpiresAt)
        : null,
    };
  }
}
