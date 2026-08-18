import { runWithOperationSpan } from '@eventa/observability';
import { Inject } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  max,
  ne,
  sql,
} from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { EVENT_TICKET_TYPE_LIMIT } from '../constants/event.constants';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
import { eventTicketCurrencies } from '../schema/event-ticket-currency.schema';
import { eventTicketTypes } from '../schema/event-ticket-type.schema';
import { eventWaitlistEntries } from '../schema/event-waitlist-entry.schema';
import { events } from '../schema/event.schema';
import type {
  CreateEventTicketType,
  CreateEventTicketTypeResult,
  DefineEventTicketCurrency,
  DefineEventTicketCurrencyResult,
  EventTicketCurrencyRecord,
  EventTicketTypeRecord,
  EventTicketTypeRepository as EventTicketTypeRepositoryPort,
  EventTicketTypesRecord,
  RetireEventTicketTypeCommand,
  RetireEventTicketTypeResult,
  UpdateEventTicketType,
  UpdateEventTicketTypeResult,
} from '../types/event.types';

const TICKET_TYPE_COLUMNS = {
  ticketTypeId: eventTicketTypes.id,
  ticketCurrencyId: eventTicketTypes.ticketCurrencyId,
  name: eventTicketTypes.name,
  description: eventTicketTypes.description,
  priceMinor: eventTicketTypes.priceMinor,
  capacity: eventTicketTypes.capacity,
  reservedQuantity: eventTicketTypes.reservedQuantity,
  soldQuantity: eventTicketTypes.soldQuantity,
  salesStartAt: eventTicketTypes.salesStartAt,
  salesEndAt: eventTicketTypes.salesEndAt,
  createdAt: eventTicketTypes.createdAt,
  updatedAt: eventTicketTypes.updatedAt,
};

const TICKET_CURRENCY_COLUMNS = {
  ticketCurrencyId: eventTicketCurrencies.id,
  eventId: eventTicketCurrencies.eventId,
  currency: eventTicketCurrencies.currency,
  createdAt: eventTicketCurrencies.createdAt,
  updatedAt: eventTicketCurrencies.updatedAt,
};

export class EventTicketTypeRepository implements EventTicketTypeRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  defineCurrency(
    input: DefineEventTicketCurrency,
  ): Promise<DefineEventTicketCurrencyResult> {
    return runWithOperationSpan(
      'event.ticket_currency.define',
      () =>
        this.database.transaction(async (transaction) => {
          const event = await this.lockDraftEvent(transaction, input);
          if (event.outcome !== 'locked') return event;

          const [existing] = await transaction
            .select({ id: eventTicketCurrencies.id })
            .from(eventTicketCurrencies)
            .where(
              and(
                eq(eventTicketCurrencies.eventId, input.eventId),
                eq(eventTicketCurrencies.currency, input.currency),
              ),
            )
            .limit(1);
          if (existing !== undefined) {
            return { outcome: 'currency_conflict' as const };
          }

          const [ticketCurrency] = await transaction
            .insert(eventTicketCurrencies)
            .values({ currency: input.currency, eventId: input.eventId })
            .returning(TICKET_CURRENCY_COLUMNS);
          if (ticketCurrency === undefined) {
            throw new Error('Ticket currency insert returned no row');
          }

          const eventVersion = await this.advanceEventVersion(
            transaction,
            input,
            'event.ticket_currency_defined',
          );
          return {
            outcome: 'defined' as const,
            eventVersion,
            ticketCurrency,
          };
        }),
      {
        attributes: {
          'db.collection.name': 'event_ticket_currencies',
          'db.namespace': 'eventa_event',
          'db.operation.name': 'INSERT',
          'db.system.name': 'postgresql',
        },
        kind: 'client',
      },
    );
  }

  create(input: CreateEventTicketType): Promise<CreateEventTicketTypeResult> {
    return runWithOperationSpan(
      'event.ticket_type.create',
      () =>
        this.database.transaction(async (transaction) => {
          const event = await this.lockDraftEvent(transaction, input);
          if (event.outcome !== 'locked') return event;
          if (event.startsAt === null || input.salesEndAt > event.startsAt) {
            return { outcome: 'invalid_window' as const };
          }

          const [ticketCurrency] = await transaction
            .select({ id: eventTicketCurrencies.id })
            .from(eventTicketCurrencies)
            .where(
              and(
                eq(eventTicketCurrencies.id, input.ticketCurrencyId),
                eq(eventTicketCurrencies.eventId, input.eventId),
              ),
            )
            .limit(1);
          if (ticketCurrency === undefined) {
            return { outcome: 'currency_not_found' as const };
          }

          const [ticketTypeCount] = await transaction
            .select({ value: count() })
            .from(eventTicketTypes)
            .innerJoin(
              eventTicketCurrencies,
              eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
            )
            .where(
              and(
                eq(eventTicketCurrencies.eventId, input.eventId),
                isNull(eventTicketTypes.retiredAt),
              ),
            );
          if ((ticketTypeCount?.value ?? 0) >= EVENT_TICKET_TYPE_LIMIT) {
            return { outcome: 'limit_reached' as const };
          }

          const [existingName] = await transaction
            .select({ id: eventTicketTypes.id })
            .from(eventTicketTypes)
            .where(
              and(
                eq(eventTicketTypes.ticketCurrencyId, input.ticketCurrencyId),
                sql`lower(${eventTicketTypes.name}) = lower(${input.name})`,
                isNull(eventTicketTypes.retiredAt),
              ),
            )
            .limit(1);
          if (existingName !== undefined) {
            return { outcome: 'name_conflict' as const };
          }

          const [created] = await transaction
            .insert(eventTicketTypes)
            .values({
              capacity: input.capacity,
              description: input.description,
              name: input.name,
              priceMinor: input.priceMinor,
              salesEndAt: input.salesEndAt,
              salesStartAt: input.salesStartAt,
              ticketCurrencyId: input.ticketCurrencyId,
            })
            .returning(TICKET_TYPE_COLUMNS);
          if (created === undefined) {
            throw new Error('Ticket type insert returned no row');
          }

          const eventVersion = await this.advanceEventVersion(
            transaction,
            input,
            'event.ticket_type_created',
          );
          return {
            outcome: 'created' as const,
            eventVersion,
            ticketType: { ...created, eventId: input.eventId },
          };
        }),
      {
        attributes: {
          'db.collection.name': 'event_ticket_types',
          'db.namespace': 'eventa_event',
          'db.operation.name': 'INSERT',
          'db.system.name': 'postgresql',
        },
        kind: 'client',
      },
    );
  }

  update(input: UpdateEventTicketType): Promise<UpdateEventTicketTypeResult> {
    return runWithOperationSpan(
      'event.ticket_type.update',
      () =>
        this.database.transaction(async (transaction) => {
          const event = await this.lockActiveEvent(transaction, input);
          if (event.outcome !== 'locked') return event;
          if (event.version !== input.expectedVersion) {
            return { outcome: 'version_conflict' as const };
          }
          if (event.startsAt === null || input.salesEndAt > event.startsAt) {
            return { outcome: 'invalid_window' as const };
          }

          const [ticketType] = await transaction
            .select({
              ...TICKET_TYPE_COLUMNS,
              eventId: eventTicketCurrencies.eventId,
            })
            .from(eventTicketTypes)
            .innerJoin(
              eventTicketCurrencies,
              eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
            )
            .where(
              and(
                eq(eventTicketTypes.id, input.ticketTypeId),
                eq(eventTicketCurrencies.eventId, input.eventId),
                isNull(eventTicketTypes.retiredAt),
              ),
            )
            .limit(1)
            .for('update', { of: eventTicketTypes });
          if (ticketType === undefined) {
            return { outcome: 'not_found' as const };
          }

          const committed =
            ticketType.reservedQuantity + ticketType.soldQuantity;
          if (input.capacity < committed) {
            return { outcome: 'capacity_below_committed' as const };
          }
          const [activeWaitlistDemand] = await transaction
            .select({ quantity: max(eventWaitlistEntries.quantity) })
            .from(eventWaitlistEntries)
            .where(
              and(
                eq(eventWaitlistEntries.ticketTypeId, input.ticketTypeId),
                inArray(eventWaitlistEntries.status, ['waiting', 'eligible']),
              ),
            );
          if (
            activeWaitlistDemand?.quantity !== null &&
            activeWaitlistDemand?.quantity !== undefined &&
            input.capacity < activeWaitlistDemand.quantity
          ) {
            return { outcome: 'capacity_below_waitlist_demand' as const };
          }
          if (
            committed > 0 &&
            (input.priceMinor !== ticketType.priceMinor ||
              input.salesStartAt.getTime() !==
                ticketType.salesStartAt.getTime() ||
              input.salesEndAt.getTime() !== ticketType.salesEndAt.getTime())
          ) {
            return { outcome: 'commercial_terms_locked' as const };
          }

          const [existingName] = await transaction
            .select({ id: eventTicketTypes.id })
            .from(eventTicketTypes)
            .where(
              and(
                eq(
                  eventTicketTypes.ticketCurrencyId,
                  ticketType.ticketCurrencyId,
                ),
                sql`lower(${eventTicketTypes.name}) = lower(${input.name})`,
                ne(eventTicketTypes.id, input.ticketTypeId),
                isNull(eventTicketTypes.retiredAt),
              ),
            )
            .limit(1);
          if (existingName !== undefined) {
            return { outcome: 'name_conflict' as const };
          }

          const [updated] = await transaction
            .update(eventTicketTypes)
            .set({
              capacity: input.capacity,
              description: input.description,
              name: input.name,
              priceMinor: input.priceMinor,
              salesEndAt: input.salesEndAt,
              salesStartAt: input.salesStartAt,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(eventTicketTypes.id, input.ticketTypeId),
                isNull(eventTicketTypes.retiredAt),
              ),
            )
            .returning(TICKET_TYPE_COLUMNS);
          if (updated === undefined) {
            throw new Error('Locked ticket type changed during update');
          }
          const eventVersion = await this.advanceEventVersion(
            transaction,
            input,
            'event.ticket_type_updated',
          );
          return {
            outcome: 'updated' as const,
            eventVersion,
            ticketType: { ...updated, eventId: input.eventId },
          };
        }),
      {
        attributes: {
          'db.collection.name': 'event_ticket_types',
          'db.namespace': 'eventa_event',
          'db.operation.name': 'UPDATE',
          'db.system.name': 'postgresql',
        },
        kind: 'client',
      },
    );
  }

  retire(
    input: RetireEventTicketTypeCommand,
  ): Promise<RetireEventTicketTypeResult> {
    return runWithOperationSpan(
      'event.ticket_type.retire',
      () =>
        this.database.transaction(async (transaction) => {
          const event = await this.lockActiveEvent(transaction, input);
          if (event.outcome !== 'locked') return event;

          const [ticketType] = await transaction
            .select({
              reservedQuantity: eventTicketTypes.reservedQuantity,
              retiredEventVersion: eventTicketTypes.retiredEventVersion,
              soldQuantity: eventTicketTypes.soldQuantity,
            })
            .from(eventTicketTypes)
            .innerJoin(
              eventTicketCurrencies,
              eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
            )
            .where(
              and(
                eq(eventTicketTypes.id, input.ticketTypeId),
                eq(eventTicketCurrencies.eventId, input.eventId),
              ),
            )
            .limit(1)
            .for('update', { of: eventTicketTypes });
          if (ticketType === undefined) {
            return { outcome: 'not_found' as const };
          }
          if (ticketType.retiredEventVersion !== null) {
            return {
              outcome: 'already_retired' as const,
              eventVersion: ticketType.retiredEventVersion,
            };
          }
          if (event.version !== input.expectedVersion) {
            return { outcome: 'version_conflict' as const };
          }
          if (ticketType.reservedQuantity > 0 || ticketType.soldQuantity > 0) {
            return { outcome: 'committed_inventory' as const };
          }
          if (event.status === 'published') {
            const [activeCount] = await transaction
              .select({ value: count() })
              .from(eventTicketTypes)
              .innerJoin(
                eventTicketCurrencies,
                eq(eventTicketCurrencies.id, eventTicketTypes.ticketCurrencyId),
              )
              .where(
                and(
                  eq(eventTicketCurrencies.eventId, input.eventId),
                  isNull(eventTicketTypes.retiredAt),
                ),
              );
            if ((activeCount?.value ?? 0) <= 1) {
              return { outcome: 'last_published_type' as const };
            }
          }

          const resultingVersion = input.expectedVersion + 1;
          const [retired] = await transaction
            .update(eventTicketTypes)
            .set({
              retiredAt: sql`now()`,
              retiredEventVersion: resultingVersion,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(eventTicketTypes.id, input.ticketTypeId),
                isNull(eventTicketTypes.retiredAt),
              ),
            )
            .returning({ id: eventTicketTypes.id });
          if (retired === undefined) {
            throw new Error('Locked ticket type changed during retirement');
          }
          const eventVersion = await this.advanceEventVersion(
            transaction,
            input,
            'event.ticket_type_retired',
          );
          return { outcome: 'retired' as const, eventVersion };
        }),
      {
        attributes: {
          'db.collection.name': 'event_ticket_types',
          'db.namespace': 'eventa_event',
          'db.operation.name': 'UPDATE',
          'db.system.name': 'postgresql',
        },
        kind: 'client',
      },
    );
  }

  list(eventId: string): Promise<EventTicketTypesRecord | undefined> {
    return runWithOperationSpan(
      'event.ticket_type.list',
      async () => {
        const rows = await this.database
          .select({
            eventVersion: events.version,
            ticketCurrency: TICKET_CURRENCY_COLUMNS,
            ticketType: TICKET_TYPE_COLUMNS,
          })
          .from(events)
          .leftJoin(
            eventTicketCurrencies,
            eq(eventTicketCurrencies.eventId, events.id),
          )
          .leftJoin(
            eventTicketTypes,
            and(
              eq(eventTicketTypes.ticketCurrencyId, eventTicketCurrencies.id),
              isNull(eventTicketTypes.retiredAt),
            ),
          )
          .where(and(eq(events.id, eventId), isNull(events.retiredAt)))
          .orderBy(
            asc(eventTicketCurrencies.createdAt),
            asc(eventTicketCurrencies.id),
            asc(eventTicketTypes.createdAt),
            asc(eventTicketTypes.id),
          );
        const first = rows[0];
        if (first === undefined) return undefined;

        const currencyById = new Map<string, EventTicketCurrencyRecord>();
        const ticketTypes: EventTicketTypeRecord[] = [];
        for (const row of rows) {
          if (row.ticketCurrency !== null) {
            currencyById.set(
              row.ticketCurrency.ticketCurrencyId,
              row.ticketCurrency,
            );
          }
          if (row.ticketType !== null) {
            ticketTypes.push({ ...row.ticketType, eventId });
          }
        }
        return {
          eventVersion: first.eventVersion,
          ticketCurrencies: [...currencyById.values()],
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

  private async lockDraftEvent(
    transaction: Parameters<Parameters<EventDatabase['transaction']>[0]>[0],
    input: { eventId: string; expectedVersion: number },
  ) {
    const [event] = await transaction
      .select({
        startsAt: events.startsAt,
        status: events.status,
        version: events.version,
      })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.retiredAt)))
      .limit(1)
      .for('update', { of: events });
    if (event === undefined) return { outcome: 'not_found' as const };
    if (event.status !== 'draft') return { outcome: 'not_draft' as const };
    if (event.version !== input.expectedVersion) {
      return { outcome: 'version_conflict' as const };
    }
    return { outcome: 'locked' as const, startsAt: event.startsAt };
  }

  private async lockActiveEvent(
    transaction: Parameters<Parameters<EventDatabase['transaction']>[0]>[0],
    input: { eventId: string },
  ) {
    const [event] = await transaction
      .select({
        startsAt: events.startsAt,
        status: events.status,
        version: events.version,
      })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.retiredAt)))
      .limit(1)
      .for('update', { of: events });
    if (event === undefined) return { outcome: 'not_found' as const };
    return { outcome: 'locked' as const, ...event };
  }

  private async advanceEventVersion(
    transaction: Parameters<Parameters<EventDatabase['transaction']>[0]>[0],
    input: {
      actorAdminId: string;
      eventId: string;
      expectedVersion: number;
      requestId: string;
    },
    action:
      | 'event.ticket_currency_defined'
      | 'event.ticket_type_created'
      | 'event.ticket_type_updated'
      | 'event.ticket_type_retired',
  ): Promise<number> {
    const [updatedEvent] = await transaction
      .update(events)
      .set({ updatedAt: sql`now()`, version: sql`${events.version} + 1` })
      .where(
        and(
          eq(events.id, input.eventId),
          eq(events.version, input.expectedVersion),
          isNull(events.retiredAt),
        ),
      )
      .returning({ version: events.version });
    if (updatedEvent === undefined) {
      throw new Error('Locked event changed during ticket catalogue mutation');
    }
    await transaction.insert(eventAdminAuditLog).values({
      action,
      actorAdminId: input.actorAdminId,
      eventId: input.eventId,
      eventVersion: updatedEvent.version,
      requestId: input.requestId,
    });
    return updatedEvent.version;
  }
}
