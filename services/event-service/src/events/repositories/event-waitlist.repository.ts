import { runWithOperationSpan } from '@eventa/observability';
import { Inject } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import {
  EVENT_CAPACITY_LOCK_TIMEOUT_MS,
  EVENT_WAITLIST_ACTIVE_LIMIT,
  EVENT_WAITLIST_OPPORTUNITY_MINUTES,
} from '../constants/event.constants';
import { eventCapacityReservations } from '../schema/event-capacity-reservation.schema';
import { eventTicketCurrencies } from '../schema/event-ticket-currency.schema';
import { eventTicketTypes } from '../schema/event-ticket-type.schema';
import { eventWaitlistEntries } from '../schema/event-waitlist-entry.schema';
import { eventWaitlistOutbox } from '../schema/event-waitlist-outbox.schema';
import { events } from '../schema/event.schema';
import type {
  EventWaitlistCommand,
  EventWaitlistEntryRecord,
  EventWaitlistRepository as EventWaitlistRepositoryPort,
  JoinEventWaitlistCommand,
  JoinEventWaitlistResult,
  LeaveEventWaitlistResult,
} from '../types/event.types';

type EventTransaction = Parameters<
  Parameters<EventDatabase['transaction']>[0]
>[0];

const ACTIVE_STATUSES = ['waiting', 'eligible'] as const;

const ENTRY_COLUMNS = {
  waitlistEntryId: eventWaitlistEntries.id,
  ticketTypeId: eventWaitlistEntries.ticketTypeId,
  attendeeId: eventWaitlistEntries.attendeeId,
  quantity: eventWaitlistEntries.quantity,
  status: eventWaitlistEntries.status,
  eligibleAt: eventWaitlistEntries.eligibleAt,
  opportunityExpiresAt: eventWaitlistEntries.opportunityExpiresAt,
  createdAt: eventWaitlistEntries.createdAt,
  updatedAt: eventWaitlistEntries.updatedAt,
};

interface SelectedWaitlistEntry {
  waitlistEntryId: string;
  ticketTypeId: string;
  attendeeId: string;
  quantity: number;
  status: 'waiting' | 'eligible' | 'left' | 'closed' | 'expired' | 'reserved';
  eligibleAt: Date | null;
  opportunityExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class EventWaitlistRepository implements EventWaitlistRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE) private readonly database: EventDatabase,
  ) {}

  join(input: JoinEventWaitlistCommand): Promise<JoinEventWaitlistResult> {
    return this.withLockTimeout(
      runWithOperationSpan(
        'event.waitlist.join',
        () =>
          this.database.transaction(async (transaction) => {
            await this.configureLockTimeout(transaction);
            const ticketType = await this.lockTicketType(
              transaction,
              input.eventId,
              input.ticketTypeId,
            );
            if (ticketType === undefined)
              return { outcome: 'not_found' as const };
            if (
              ticketType.status !== 'published' ||
              ticketType.retiredAt !== null ||
              !ticketType.salesOpen
            ) {
              return { outcome: 'sales_unavailable' as const };
            }
            if (input.quantity > ticketType.capacity) {
              return { outcome: 'quantity_exceeds_capacity' as const };
            }

            await this.expireDueEligibility(transaction, input.ticketTypeId);
            const existing = await this.findActive(
              transaction,
              input.ticketTypeId,
              input.attendeeId,
            );
            if (existing !== undefined) {
              if (existing.quantity !== input.quantity)
                return { outcome: 'quantity_conflict' as const };
              return {
                outcome: 'existing' as const,
                entry: await this.withPosition(
                  transaction,
                  input.eventId,
                  existing,
                ),
              };
            }

            const [activeReservation] = await transaction
              .select({ id: eventCapacityReservations.id })
              .from(eventCapacityReservations)
              .where(
                and(
                  eq(
                    eventCapacityReservations.ticketTypeId,
                    input.ticketTypeId,
                  ),
                  eq(eventCapacityReservations.attendeeId, input.attendeeId),
                  eq(eventCapacityReservations.status, 'active'),
                  sql`${eventCapacityReservations.expiresAt} > now()`,
                ),
              )
              .limit(1);
            if (activeReservation !== undefined) {
              return { outcome: 'active_reservation' as const };
            }

            const expiredQuantity = await this.expireDueReservations(
              transaction,
              input.ticketTypeId,
            );
            const available =
              ticketType.capacity -
              (ticketType.reservedQuantity - expiredQuantity) -
              ticketType.soldQuantity;
            const [eligibleQuantityRow] = await transaction
              .select({
                value: sql<number>`coalesce(sum(${eventWaitlistEntries.quantity}), 0)::int`,
              })
              .from(eventWaitlistEntries)
              .where(
                and(
                  eq(eventWaitlistEntries.ticketTypeId, input.ticketTypeId),
                  eq(eventWaitlistEntries.status, 'eligible'),
                ),
              );
            const [activeCountRow] = await transaction
              .select({
                value: count(),
                waiting: sql<number>`count(*) filter (where ${eventWaitlistEntries.status} = 'waiting')::int`,
              })
              .from(eventWaitlistEntries)
              .where(
                and(
                  eq(eventWaitlistEntries.ticketTypeId, input.ticketTypeId),
                  inArray(eventWaitlistEntries.status, [...ACTIVE_STATUSES]),
                ),
              );
            if (
              (activeCountRow?.waiting ?? 0) === 0 &&
              available - (eligibleQuantityRow?.value ?? 0) >= input.quantity
            ) {
              return { outcome: 'capacity_available' as const };
            }
            if ((activeCountRow?.value ?? 0) >= EVENT_WAITLIST_ACTIVE_LIMIT)
              return { outcome: 'full' as const };

            const [created] = await transaction
              .insert(eventWaitlistEntries)
              .values({
                attendeeId: input.attendeeId,
                quantity: input.quantity,
                ticketTypeId: input.ticketTypeId,
              })
              .returning(ENTRY_COLUMNS);
            if (created === undefined)
              throw new Error('Waitlist insert returned no row');
            return {
              outcome: 'joined' as const,
              entry: await this.withPosition(
                transaction,
                input.eventId,
                created,
              ),
            };
          }),
        this.spanAttributes('INSERT'),
      ),
    );
  }

  leave(input: EventWaitlistCommand): Promise<LeaveEventWaitlistResult> {
    return this.withLockTimeout(
      runWithOperationSpan(
        'event.waitlist.leave',
        () =>
          this.database.transaction(async (transaction) => {
            await this.configureLockTimeout(transaction);
            const ticketType = await this.lockTicketType(
              transaction,
              input.eventId,
              input.ticketTypeId,
            );
            if (ticketType === undefined)
              return { outcome: 'not_found' as const };
            const [left] = await transaction
              .update(eventWaitlistEntries)
              .set({
                leftAt: sql`now()`,
                status: 'left',
                updatedAt: sql`now()`,
              })
              .where(
                and(
                  eq(eventWaitlistEntries.ticketTypeId, input.ticketTypeId),
                  eq(eventWaitlistEntries.attendeeId, input.attendeeId),
                  inArray(eventWaitlistEntries.status, [...ACTIVE_STATUSES]),
                ),
              )
              .returning({ id: eventWaitlistEntries.id });
            return left === undefined
              ? { outcome: 'unchanged' as const }
              : { outcome: 'left' as const };
          }),
        this.spanAttributes('UPDATE'),
      ),
    );
  }

  find(
    input: Omit<EventWaitlistCommand, 'requestId'>,
  ): Promise<EventWaitlistEntryRecord | undefined> {
    return runWithOperationSpan(
      'event.waitlist.find',
      async () => {
        const [entry] = await this.database
          .select(ENTRY_COLUMNS)
          .from(eventWaitlistEntries)
          .innerJoin(
            eventTicketTypes,
            eq(eventTicketTypes.id, eventWaitlistEntries.ticketTypeId),
          )
          .innerJoin(
            eventTicketCurrencies,
            eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
          )
          .where(
            and(
              eq(eventTicketCurrencies.eventId, input.eventId),
              eq(eventWaitlistEntries.ticketTypeId, input.ticketTypeId),
              eq(eventWaitlistEntries.attendeeId, input.attendeeId),
              or(
                eq(eventWaitlistEntries.status, 'waiting'),
                and(
                  eq(eventWaitlistEntries.status, 'eligible'),
                  sql`${eventWaitlistEntries.opportunityExpiresAt} > now()`,
                ),
              ),
            ),
          )
          .limit(1);
        return entry === undefined
          ? undefined
          : this.withPosition(this.database, input.eventId, entry);
      },
      this.spanAttributes('SELECT'),
    );
  }

  findPromotionCandidates(
    afterTicketTypeId: string | null,
    limit: number,
  ): Promise<string[]> {
    return runWithOperationSpan(
      'event.waitlist.find_promotion_candidates',
      async () => {
        const rows = await this.database
          .selectDistinct({ ticketTypeId: eventWaitlistEntries.ticketTypeId })
          .from(eventWaitlistEntries)
          .where(
            and(
              or(
                eq(eventWaitlistEntries.status, 'waiting'),
                and(
                  eq(eventWaitlistEntries.status, 'eligible'),
                  lte(eventWaitlistEntries.opportunityExpiresAt, sql`now()`),
                ),
              ),
              afterTicketTypeId === null
                ? undefined
                : gt(eventWaitlistEntries.ticketTypeId, afterTicketTypeId),
            ),
          )
          .orderBy(asc(eventWaitlistEntries.ticketTypeId))
          .limit(limit);
        return rows.map(({ ticketTypeId }) => ticketTypeId);
      },
      this.spanAttributes('SELECT'),
    );
  }

  promote(ticketTypeId: string, limit: number): Promise<number> {
    return runWithOperationSpan(
      'event.waitlist.promote',
      () =>
        this.database.transaction(async (transaction) => {
          await this.configureLockTimeout(transaction);
          const ticketType = await this.lockTicketTypeById(
            transaction,
            ticketTypeId,
          );
          if (ticketType === undefined) return 0;
          if (
            ticketType.status !== 'published' ||
            ticketType.retiredAt !== null ||
            !ticketType.salesOpen
          ) {
            await transaction
              .update(eventWaitlistEntries)
              .set({
                closedAt: sql`now()`,
                status: 'closed',
                updatedAt: sql`now()`,
              })
              .where(
                and(
                  eq(eventWaitlistEntries.ticketTypeId, ticketTypeId),
                  inArray(eventWaitlistEntries.status, [...ACTIVE_STATUSES]),
                ),
              );
            return 0;
          }
          await this.expireDueEligibility(transaction, ticketTypeId);
          const expiredQuantity = await this.expireDueReservations(
            transaction,
            ticketTypeId,
          );
          const available =
            ticketType.capacity -
            (ticketType.reservedQuantity - expiredQuantity) -
            ticketType.soldQuantity;
          const [eligibleQuantityRow] = await transaction
            .select({
              value: sql<number>`coalesce(sum(${eventWaitlistEntries.quantity}), 0)::int`,
            })
            .from(eventWaitlistEntries)
            .where(
              and(
                eq(eventWaitlistEntries.ticketTypeId, ticketTypeId),
                eq(eventWaitlistEntries.status, 'eligible'),
              ),
            );
          let promotionBudget = available - (eligibleQuantityRow?.value ?? 0);
          if (promotionBudget < 1) return 0;
          const waiting = await transaction
            .select({
              id: eventWaitlistEntries.id,
              quantity: eventWaitlistEntries.quantity,
            })
            .from(eventWaitlistEntries)
            .where(
              and(
                eq(eventWaitlistEntries.ticketTypeId, ticketTypeId),
                eq(eventWaitlistEntries.status, 'waiting'),
              ),
            )
            .orderBy(
              asc(eventWaitlistEntries.createdAt),
              asc(eventWaitlistEntries.id),
            )
            .limit(limit)
            .for('update', { skipLocked: true });
          const promotedIds: string[] = [];
          for (const entry of waiting) {
            if (entry.quantity > promotionBudget) break;
            promotedIds.push(entry.id);
            promotionBudget -= entry.quantity;
          }
          if (promotedIds.length === 0) return 0;
          const promoted = await transaction
            .update(eventWaitlistEntries)
            .set({
              eligibleAt: sql`now()`,
              opportunityExpiresAt: sql`least(now() + make_interval(mins => ${EVENT_WAITLIST_OPPORTUNITY_MINUTES}), ${ticketType.salesEndAt}, ${ticketType.eventStartsAt})`,
              status: 'eligible',
              updatedAt: sql`now()`,
            })
            .where(
              and(
                inArray(eventWaitlistEntries.id, promotedIds),
                eq(eventWaitlistEntries.status, 'waiting'),
              ),
            )
            .returning({
              attendeeId: eventWaitlistEntries.attendeeId,
              eligibleAt: eventWaitlistEntries.eligibleAt,
              id: eventWaitlistEntries.id,
              opportunityExpiresAt: eventWaitlistEntries.opportunityExpiresAt,
              quantity: eventWaitlistEntries.quantity,
            });
          const facts = promoted.map((entry) => {
            if (
              entry.eligibleAt === null ||
              entry.opportunityExpiresAt === null
            ) {
              throw new Error(
                'Promoted waitlist entry has no opportunity window',
              );
            }
            return {
              aggregateType: 'eventa.event.waitlist.v1',
              factId: entry.id,
              eventType: 'event.waitlist-entry.eligible.v1',
              occurredAt: entry.eligibleAt,
              payload: {
                attendeeId: entry.attendeeId,
                eligibleAt: entry.eligibleAt.toISOString(),
                eventId: ticketType.eventId,
                opportunityExpiresAt: entry.opportunityExpiresAt.toISOString(),
                quantity: entry.quantity,
                ticketTypeId,
                type: 'event.waitlist-entry.eligible.v1',
                waitlistEntryId: entry.id,
              },
            } as const;
          });
          await transaction.insert(eventWaitlistOutbox).values(facts);
          return promoted.length;
        }),
      this.spanAttributes('UPDATE'),
    ).catch((error: unknown) => {
      if (this.isLockTimeout(error)) return 0;
      throw error;
    });
  }

  private async lockTicketType(
    transaction: EventTransaction,
    eventId: string,
    ticketTypeId: string,
  ) {
    const [row] = await transaction
      .select({
        capacity: eventTicketTypes.capacity,
        reservedQuantity: eventTicketTypes.reservedQuantity,
        soldQuantity: eventTicketTypes.soldQuantity,
        retiredAt: eventTicketTypes.retiredAt,
        salesEndAt: eventTicketTypes.salesEndAt,
        eventStartsAt: events.startsAt,
        eventId: events.id,
        salesOpen: sql<boolean>`${eventTicketTypes.salesStartAt} <= now() AND ${eventTicketTypes.salesEndAt} > now() AND ${events.startsAt} > now()`,
        status: events.status,
      })
      .from(eventTicketTypes)
      .innerJoin(
        eventTicketCurrencies,
        eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
      )
      .innerJoin(events, eq(events.id, eventTicketCurrencies.eventId))
      .where(
        and(
          eq(eventTicketTypes.id, ticketTypeId),
          eq(events.id, eventId),
          isNull(events.retiredAt),
        ),
      )
      .limit(1)
      .for('update', { of: eventTicketTypes });
    return row;
  }

  private async lockTicketTypeById(
    transaction: EventTransaction,
    ticketTypeId: string,
  ) {
    const [row] = await transaction
      .select({
        capacity: eventTicketTypes.capacity,
        reservedQuantity: eventTicketTypes.reservedQuantity,
        soldQuantity: eventTicketTypes.soldQuantity,
        retiredAt: eventTicketTypes.retiredAt,
        salesEndAt: eventTicketTypes.salesEndAt,
        eventStartsAt: events.startsAt,
        eventId: events.id,
        salesOpen: sql<boolean>`${eventTicketTypes.salesStartAt} <= now() AND ${eventTicketTypes.salesEndAt} > now() AND ${events.startsAt} > now()`,
        status: events.status,
      })
      .from(eventTicketTypes)
      .innerJoin(
        eventTicketCurrencies,
        eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
      )
      .innerJoin(events, eq(events.id, eventTicketCurrencies.eventId))
      .where(
        and(eq(eventTicketTypes.id, ticketTypeId), isNull(events.retiredAt)),
      )
      .limit(1)
      .for('update', { of: eventTicketTypes });
    return row;
  }

  private async findActive(
    transaction: EventTransaction,
    ticketTypeId: string,
    attendeeId: string,
  ) {
    const [entry] = await transaction
      .select(ENTRY_COLUMNS)
      .from(eventWaitlistEntries)
      .where(
        and(
          eq(eventWaitlistEntries.ticketTypeId, ticketTypeId),
          eq(eventWaitlistEntries.attendeeId, attendeeId),
          inArray(eventWaitlistEntries.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);
    return entry;
  }

  private async withPosition(
    database: EventDatabase | EventTransaction,
    eventId: string,
    entry: SelectedWaitlistEntry,
  ): Promise<EventWaitlistEntryRecord> {
    let position: number | null = null;
    if (entry.status === 'waiting') {
      const [positionRow] = await database
        .select({ value: count() })
        .from(eventWaitlistEntries)
        .where(
          and(
            eq(eventWaitlistEntries.ticketTypeId, entry.ticketTypeId),
            or(
              eq(eventWaitlistEntries.status, 'eligible'),
              and(
                eq(eventWaitlistEntries.status, 'waiting'),
                or(
                  lt(eventWaitlistEntries.createdAt, entry.createdAt),
                  and(
                    eq(eventWaitlistEntries.createdAt, entry.createdAt),
                    lt(eventWaitlistEntries.id, entry.waitlistEntryId),
                  ),
                ),
              ),
            ),
          ),
        );
      position = (positionRow?.value ?? 0) + 1;
    }
    if (entry.status !== 'waiting' && entry.status !== 'eligible')
      throw new Error('Inactive waitlist entry selected');
    return { ...entry, eventId, position, status: entry.status };
  }

  private async expireDueReservations(
    transaction: EventTransaction,
    ticketTypeId: string,
  ): Promise<number> {
    const expired = await transaction
      .update(eventCapacityReservations)
      .set({
        completedAt: sql`now()`,
        status: 'expired',
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(eventCapacityReservations.ticketTypeId, ticketTypeId),
          eq(eventCapacityReservations.status, 'active'),
          sql`${eventCapacityReservations.expiresAt} <= now()`,
        ),
      )
      .returning({ quantity: eventCapacityReservations.quantity });
    const quantity = expired.reduce((total, row) => total + row.quantity, 0);
    if (quantity > 0) {
      await transaction
        .update(eventTicketTypes)
        .set({
          reservedQuantity: sql`${eventTicketTypes.reservedQuantity} - ${quantity}`,
          updatedAt: sql`now()`,
        })
        .where(eq(eventTicketTypes.id, ticketTypeId));
    }
    return quantity;
  }

  private async expireDueEligibility(
    transaction: EventTransaction,
    ticketTypeId: string,
  ): Promise<void> {
    await transaction
      .update(eventWaitlistEntries)
      .set({
        closedAt: sql`now()`,
        status: 'expired',
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(eventWaitlistEntries.ticketTypeId, ticketTypeId),
          eq(eventWaitlistEntries.status, 'eligible'),
          lte(eventWaitlistEntries.opportunityExpiresAt, sql`now()`),
        ),
      );
  }

  private spanAttributes(operation: 'INSERT' | 'SELECT' | 'UPDATE') {
    return {
      attributes: {
        'db.collection.name': 'event_waitlist_entries',
        'db.namespace': 'eventa_event',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client' as const,
    };
  }

  private configureLockTimeout(
    transaction: EventTransaction,
  ): Promise<unknown> {
    return transaction.execute(
      sql`select set_config('lock_timeout', ${`${EVENT_CAPACITY_LOCK_TIMEOUT_MS}ms`}, true)`,
    );
  }

  private async withLockTimeout<T>(
    operation: Promise<T>,
  ): Promise<T | { outcome: 'busy' }> {
    try {
      return await operation;
    } catch (error: unknown) {
      if (this.isLockTimeout(error)) return { outcome: 'busy' };
      throw error;
    }
  }

  private isLockTimeout(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'code') === '55P03'
    );
  }
}
