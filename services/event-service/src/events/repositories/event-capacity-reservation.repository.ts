import { runWithOperationSpan } from '@eventa/observability';
import { Inject } from '@nestjs/common';
import { and, asc, count, eq, lte, sql } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import {
  EVENT_CAPACITY_LOCK_TIMEOUT_MS,
  EVENT_CAPACITY_RESERVATION_TTL_MINUTES,
} from '../constants/event.constants';
import { eventCapacityReservations } from '../schema/event-capacity-reservation.schema';
import { eventTicketCurrencies } from '../schema/event-ticket-currency.schema';
import { eventTicketTypes } from '../schema/event-ticket-type.schema';
import { eventWaitlistEntries } from '../schema/event-waitlist-entry.schema';
import { events } from '../schema/event.schema';
import type {
  EventCapacityReservationRecord,
  EventCapacityReservationRepository as EventCapacityReservationRepositoryPort,
  FinalizeEventCapacityReservationResult,
  ReleaseEventCapacityReservationResult,
  ReserveEventCapacityCommand,
  ReserveEventCapacityResult,
  TransitionEventCapacityReservationCommand,
} from '../types/event.types';

type EventTransaction = Parameters<
  Parameters<EventDatabase['transaction']>[0]
>[0];

const RESERVATION_COLUMNS = {
  reservationId: eventCapacityReservations.id,
  ticketTypeId: eventCapacityReservations.ticketTypeId,
  attendeeId: eventCapacityReservations.attendeeId,
  quantity: eventCapacityReservations.quantity,
  status: eventCapacityReservations.status,
  expiresAt: eventCapacityReservations.expiresAt,
  completedAt: eventCapacityReservations.completedAt,
  createdAt: eventCapacityReservations.createdAt,
  updatedAt: eventCapacityReservations.updatedAt,
};

export class EventCapacityReservationRepository implements EventCapacityReservationRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  reserve(
    input: ReserveEventCapacityCommand,
  ): Promise<ReserveEventCapacityResult> {
    return this.withLockTimeout(
      runWithOperationSpan(
        'event.capacity.reserve',
        () =>
          this.database.transaction(async (transaction) => {
            await this.configureLockTimeout(transaction);
            await this.lockIdempotencyKey(transaction, input.reservationId);
            const existing = await this.findReservation(
              transaction,
              input.reservationId,
            );
            if (existing !== undefined) {
              return existing.eventId === input.eventId &&
                existing.ticketTypeId === input.ticketTypeId &&
                existing.attendeeId === input.attendeeId &&
                existing.quantity === input.quantity
                ? { outcome: 'existing' as const, reservation: existing }
                : { outcome: 'idempotency_conflict' as const };
            }

            const ticketType = await this.lockTicketType(
              transaction,
              input.eventId,
              input.ticketTypeId,
            );
            if (ticketType === undefined)
              return { outcome: 'not_found' as const };
            if (
              ticketType.eventStatus !== 'published' ||
              ticketType.retiredAt !== null ||
              !ticketType.salesOpen
            ) {
              return { outcome: 'sales_unavailable' as const };
            }

            const expiredQuantity = await this.expireDueForTicketType(
              transaction,
              input.ticketTypeId,
            );
            const reservedQuantity =
              ticketType.reservedQuantity - expiredQuantity;
            await this.expireDueWaitlistEligibility(
              transaction,
              input.ticketTypeId,
            );
            const [eligibleEntry] = await transaction
              .select({
                id: eventWaitlistEntries.id,
                quantity: eventWaitlistEntries.quantity,
              })
              .from(eventWaitlistEntries)
              .where(
                and(
                  eq(eventWaitlistEntries.ticketTypeId, input.ticketTypeId),
                  eq(eventWaitlistEntries.attendeeId, input.attendeeId),
                  eq(eventWaitlistEntries.status, 'eligible'),
                ),
              )
              .limit(1);
            if (
              eligibleEntry !== undefined &&
              eligibleEntry.quantity !== input.quantity
            ) {
              return { outcome: 'waitlist_quantity_conflict' as const };
            }
            if (eligibleEntry === undefined) {
              const [waitingRow] = await transaction
                .select({ value: count() })
                .from(eventWaitlistEntries)
                .where(
                  and(
                    eq(eventWaitlistEntries.ticketTypeId, input.ticketTypeId),
                    eq(eventWaitlistEntries.status, 'waiting'),
                  ),
                );
              if ((waitingRow?.value ?? 0) > 0) {
                return { outcome: 'waitlist_priority' as const };
              }
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
              const publicCapacity =
                ticketType.capacity -
                reservedQuantity -
                ticketType.soldQuantity -
                (eligibleQuantityRow?.value ?? 0);
              if (publicCapacity < input.quantity) {
                return { outcome: 'waitlist_priority' as const };
              }
            }
            if (
              ticketType.capacity - reservedQuantity - ticketType.soldQuantity <
              input.quantity
            ) {
              return { outcome: 'capacity_unavailable' as const };
            }

            const [created] = await transaction
              .insert(eventCapacityReservations)
              .values({
                expiresAt: sql`least(now() + make_interval(mins => ${EVENT_CAPACITY_RESERVATION_TTL_MINUTES}), ${ticketType.salesEndAt}, ${ticketType.eventStartsAt})`,
                id: input.reservationId,
                attendeeId: input.attendeeId,
                quantity: input.quantity,
                ticketTypeId: input.ticketTypeId,
              })
              .returning(RESERVATION_COLUMNS);
            if (created === undefined) {
              throw new Error('Capacity reservation insert returned no row');
            }
            if (eligibleEntry !== undefined) {
              const [consumed] = await transaction
                .update(eventWaitlistEntries)
                .set({
                  reservationId: input.reservationId,
                  status: 'reserved',
                  updatedAt: sql`now()`,
                })
                .where(
                  and(
                    eq(eventWaitlistEntries.id, eligibleEntry.id),
                    eq(eventWaitlistEntries.status, 'eligible'),
                  ),
                )
                .returning({ id: eventWaitlistEntries.id });
              if (consumed === undefined) {
                throw new Error(
                  'Waitlist eligibility changed during reservation',
                );
              }
            }
            const [updatedType] = await transaction
              .update(eventTicketTypes)
              .set({
                reservedQuantity: sql`${eventTicketTypes.reservedQuantity} + ${input.quantity}`,
                updatedAt: sql`now()`,
              })
              .where(eq(eventTicketTypes.id, input.ticketTypeId))
              .returning({ id: eventTicketTypes.id });
            if (updatedType === undefined) {
              throw new Error('Locked ticket type changed during reservation');
            }
            return {
              outcome: 'reserved' as const,
              reservation: { ...created, eventId: input.eventId },
            };
          }),
        this.spanAttributes('INSERT'),
      ),
    );
  }

  finalize(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<FinalizeEventCapacityReservationResult> {
    return this.withLockTimeout(
      runWithOperationSpan(
        'event.capacity.finalize',
        () => this.transition(input, 'finalized'),
        this.spanAttributes('UPDATE'),
      ),
    );
  }

  release(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<ReleaseEventCapacityReservationResult> {
    return this.withLockTimeout(
      runWithOperationSpan(
        'event.capacity.release',
        () => this.transition(input, 'released'),
        this.spanAttributes('UPDATE'),
      ),
    );
  }

  findDue(limit: number): Promise<string[]> {
    return runWithOperationSpan(
      'event.capacity.find_due',
      async () => {
        const rows = await this.database
          .select({ reservationId: eventCapacityReservations.id })
          .from(eventCapacityReservations)
          .where(
            and(
              eq(eventCapacityReservations.status, 'active'),
              lte(eventCapacityReservations.expiresAt, sql`now()`),
            ),
          )
          .orderBy(
            asc(eventCapacityReservations.expiresAt),
            asc(eventCapacityReservations.id),
          )
          .limit(limit);
        return rows.map(({ reservationId }) => reservationId);
      },
      this.spanAttributes('SELECT'),
    );
  }

  expire(
    reservationId: string,
  ): Promise<'expired' | 'unchanged' | 'not_found'> {
    return runWithOperationSpan(
      'event.capacity.expire',
      () =>
        this.database.transaction(async (transaction) => {
          await this.configureLockTimeout(transaction);
          if (!(await this.tryLockIdempotencyKey(transaction, reservationId))) {
            return 'unchanged' as const;
          }
          const reservation = await this.findReservation(
            transaction,
            reservationId,
          );
          if (reservation === undefined) return 'not_found' as const;
          if (reservation.status !== 'active') return 'unchanged' as const;

          await this.lockTicketType(
            transaction,
            reservation.eventId,
            reservation.ticketTypeId,
          );
          const [expired] = await transaction
            .update(eventCapacityReservations)
            .set({
              completedAt: sql`now()`,
              status: 'expired',
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(eventCapacityReservations.id, reservationId),
                eq(eventCapacityReservations.status, 'active'),
                lte(eventCapacityReservations.expiresAt, sql`now()`),
              ),
            )
            .returning({ quantity: eventCapacityReservations.quantity });
          if (expired === undefined) return 'unchanged' as const;
          await this.decreaseReserved(
            transaction,
            reservation.ticketTypeId,
            expired.quantity,
          );
          return 'expired' as const;
        }),
      this.spanAttributes('UPDATE'),
    ).catch((error: unknown) => {
      if (this.isLockTimeout(error)) return 'unchanged' as const;
      throw error;
    });
  }

  private transition(
    input: TransitionEventCapacityReservationCommand,
    requestedStatus: 'finalized',
  ): Promise<FinalizeEventCapacityReservationResult>;
  private transition(
    input: TransitionEventCapacityReservationCommand,
    requestedStatus: 'released',
  ): Promise<ReleaseEventCapacityReservationResult>;
  private async transition(
    input: TransitionEventCapacityReservationCommand,
    requestedStatus: 'finalized' | 'released',
  ): Promise<
    | FinalizeEventCapacityReservationResult
    | ReleaseEventCapacityReservationResult
  > {
    return this.database.transaction(async (transaction) => {
      await this.configureLockTimeout(transaction);
      await this.lockIdempotencyKey(transaction, input.reservationId);
      const reservation = await this.findReservation(
        transaction,
        input.reservationId,
      );
      if (reservation === undefined) return { outcome: 'not_found' as const };
      if (
        reservation.eventId !== input.eventId ||
        reservation.ticketTypeId !== input.ticketTypeId
      ) {
        return { outcome: 'identity_conflict' as const };
      }
      if (reservation.status === requestedStatus) {
        return {
          outcome:
            requestedStatus === 'finalized'
              ? ('already_finalized' as const)
              : ('already_released' as const),
          reservation,
        };
      }
      if (reservation.status === 'expired') {
        return { outcome: 'expired' as const, reservation };
      }
      if (reservation.status !== 'active') {
        return { outcome: 'terminal_conflict' as const };
      }

      await this.lockTicketType(transaction, input.eventId, input.ticketTypeId);
      const locked = await this.findReservation(
        transaction,
        input.reservationId,
        true,
      );
      if (locked === undefined) {
        throw new Error('Capacity reservation disappeared after type lock');
      }
      if (locked.status === 'expired') {
        return { outcome: 'expired' as const, reservation: locked };
      }
      if (locked.status !== 'active') {
        return { outcome: 'terminal_conflict' as const };
      }
      const expired = await this.isExpired(transaction, input.reservationId);
      const terminalStatus = expired ? 'expired' : requestedStatus;
      const [completed] = await transaction
        .update(eventCapacityReservations)
        .set({
          completedAt: sql`now()`,
          status: terminalStatus,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(eventCapacityReservations.id, input.reservationId),
            eq(eventCapacityReservations.status, 'active'),
          ),
        )
        .returning(RESERVATION_COLUMNS);
      if (completed === undefined) {
        throw new Error(
          'Locked capacity reservation changed during transition',
        );
      }

      if (terminalStatus === 'finalized') {
        await this.moveReservedToSold(
          transaction,
          input.ticketTypeId,
          locked.quantity,
        );
      } else {
        await this.decreaseReserved(
          transaction,
          input.ticketTypeId,
          locked.quantity,
        );
      }
      const completedRecord = { ...completed, eventId: input.eventId };
      return terminalStatus === 'expired'
        ? { outcome: 'expired' as const, reservation: completedRecord }
        : {
            outcome: terminalStatus,
            reservation: completedRecord,
          };
    });
  }

  private async findReservation(
    transaction: EventTransaction,
    reservationId: string,
    lock = false,
  ): Promise<EventCapacityReservationRecord | undefined> {
    const query = transaction
      .select({
        ...RESERVATION_COLUMNS,
        eventId: eventTicketCurrencies.eventId,
      })
      .from(eventCapacityReservations)
      .innerJoin(
        eventTicketTypes,
        eq(eventTicketTypes.id, eventCapacityReservations.ticketTypeId),
      )
      .innerJoin(
        eventTicketCurrencies,
        eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
      )
      .where(eq(eventCapacityReservations.id, reservationId))
      .limit(1);
    const [reservation] = lock
      ? await query.for('update', { of: eventCapacityReservations })
      : await query;
    return reservation;
  }

  private async lockTicketType(
    transaction: EventTransaction,
    eventId: string,
    ticketTypeId: string,
  ) {
    const [ticketType] = await transaction
      .select({
        capacity: eventTicketTypes.capacity,
        eventStartsAt: events.startsAt,
        eventStatus: events.status,
        reservedQuantity: eventTicketTypes.reservedQuantity,
        retiredAt: eventTicketTypes.retiredAt,
        salesOpen: sql<boolean>`${eventTicketTypes.salesStartAt} <= now() AND ${eventTicketTypes.salesEndAt} > now()`,
        salesEndAt: eventTicketTypes.salesEndAt,
        soldQuantity: eventTicketTypes.soldQuantity,
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
          eq(eventTicketCurrencies.eventId, eventId),
        ),
      )
      .limit(1)
      .for('update', { of: eventTicketTypes });
    return ticketType;
  }

  private async expireDueForTicketType(
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
          lte(eventCapacityReservations.expiresAt, sql`now()`),
        ),
      )
      .returning({ quantity: eventCapacityReservations.quantity });
    const quantity = expired.reduce((sum, row) => sum + row.quantity, 0);
    if (quantity > 0) {
      await this.decreaseReserved(transaction, ticketTypeId, quantity);
    }
    return quantity;
  }

  private async expireDueWaitlistEligibility(
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

  private async decreaseReserved(
    transaction: EventTransaction,
    ticketTypeId: string,
    quantity: number,
  ): Promise<void> {
    const [updated] = await transaction
      .update(eventTicketTypes)
      .set({
        reservedQuantity: sql`${eventTicketTypes.reservedQuantity} - ${quantity}`,
        updatedAt: sql`now()`,
      })
      .where(eq(eventTicketTypes.id, ticketTypeId))
      .returning({ id: eventTicketTypes.id });
    if (updated === undefined) {
      throw new Error('Capacity reservation ticket type is missing');
    }
  }

  private async moveReservedToSold(
    transaction: EventTransaction,
    ticketTypeId: string,
    quantity: number,
  ): Promise<void> {
    const [updated] = await transaction
      .update(eventTicketTypes)
      .set({
        reservedQuantity: sql`${eventTicketTypes.reservedQuantity} - ${quantity}`,
        soldQuantity: sql`${eventTicketTypes.soldQuantity} + ${quantity}`,
        updatedAt: sql`now()`,
      })
      .where(eq(eventTicketTypes.id, ticketTypeId))
      .returning({ id: eventTicketTypes.id });
    if (updated === undefined) {
      throw new Error('Capacity reservation ticket type is missing');
    }
  }

  private async isExpired(
    transaction: EventTransaction,
    reservationId: string,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({
        expired: sql<boolean>`${eventCapacityReservations.expiresAt} <= now()`,
      })
      .from(eventCapacityReservations)
      .where(eq(eventCapacityReservations.id, reservationId))
      .limit(1);
    if (row === undefined) throw new Error('Capacity reservation is missing');
    return row.expired;
  }

  private lockIdempotencyKey(
    transaction: EventTransaction,
    reservationId: string,
  ): Promise<unknown> {
    return transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${reservationId}, 0))`,
    );
  }

  private async tryLockIdempotencyKey(
    transaction: EventTransaction,
    reservationId: string,
  ): Promise<boolean> {
    const [lock] = await transaction.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${reservationId}, 0)) as acquired`,
    );
    return lock?.acquired === true;
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
      if (this.isLockTimeout(error)) {
        return { outcome: 'busy' };
      }
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

  private spanAttributes(operation: 'INSERT' | 'SELECT' | 'UPDATE') {
    return {
      attributes: {
        'db.collection.name': 'event_capacity_reservations',
        'db.namespace': 'eventa_event',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client' as const,
    };
  }
}
