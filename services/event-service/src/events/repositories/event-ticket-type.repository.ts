import { runWithOperationSpan } from '@eventa/observability';
import { Inject } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { EVENT_TICKET_TYPE_LIMIT } from '../constants/event.constants';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
import { eventTicketConfigurations } from '../schema/event-ticket-configuration.schema';
import { eventTicketTypes } from '../schema/event-ticket-type.schema';
import { events } from '../schema/event.schema';
import type {
  CreateEventTicketType,
  CreateEventTicketTypeResult,
  EventTicketTypeRecord,
  EventTicketTypeRepository as EventTicketTypeRepositoryPort,
  EventTicketTypesRecord,
} from '../types/event.types';

const TICKET_TYPE_COLUMNS = {
  ticketTypeId: eventTicketTypes.id,
  eventId: eventTicketTypes.eventId,
  name: eventTicketTypes.name,
  description: eventTicketTypes.description,
  priceMinor: eventTicketTypes.priceMinor,
  allocation: eventTicketTypes.allocation,
  salesStartAt: eventTicketTypes.salesStartAt,
  salesEndAt: eventTicketTypes.salesEndAt,
  createdAt: eventTicketTypes.createdAt,
  updatedAt: eventTicketTypes.updatedAt,
};

export class EventTicketTypeRepository implements EventTicketTypeRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  create(input: CreateEventTicketType): Promise<CreateEventTicketTypeResult> {
    return runWithOperationSpan(
      'event.ticket_type.create',
      () =>
        this.database.transaction(async (transaction) => {
          const [event] = await transaction
            .select({
              eventId: events.id,
              startsAt: events.startsAt,
              status: events.status,
              version: events.version,
            })
            .from(events)
            .where(and(eq(events.id, input.eventId), isNull(events.retiredAt)))
            .limit(1)
            .for('update', { of: events });

          if (event === undefined) return { outcome: 'not_found' as const };
          if (event.status !== 'draft')
            return { outcome: 'not_draft' as const };
          if (event.version !== input.expectedVersion) {
            return { outcome: 'version_conflict' as const };
          }
          if (event.startsAt === null || input.salesEndAt > event.startsAt) {
            return { outcome: 'invalid_window' as const };
          }

          const [configuration] = await transaction
            .select({ currency: eventTicketConfigurations.currency })
            .from(eventTicketConfigurations)
            .where(eq(eventTicketConfigurations.eventId, input.eventId))
            .limit(1);

          if (
            configuration !== undefined &&
            configuration.currency !== input.currency
          ) {
            return { outcome: 'currency_conflict' as const };
          }

          const existing = await transaction
            .select({ name: eventTicketTypes.name })
            .from(eventTicketTypes)
            .where(eq(eventTicketTypes.eventId, input.eventId));

          if (existing.length >= EVENT_TICKET_TYPE_LIMIT) {
            return { outcome: 'limit_reached' as const };
          }
          const normalizedName = input.name.toLocaleLowerCase('en');
          if (
            existing.some(
              (ticketType) =>
                ticketType.name.toLocaleLowerCase('en') === normalizedName,
            )
          ) {
            return { outcome: 'name_conflict' as const };
          }

          if (configuration === undefined) {
            await transaction.insert(eventTicketConfigurations).values({
              currency: input.currency,
              eventId: input.eventId,
            });
          }

          const [ticketType] = await transaction
            .insert(eventTicketTypes)
            .values({
              allocation: input.allocation,
              description: input.description,
              eventId: input.eventId,
              name: input.name,
              priceMinor: input.priceMinor,
              salesEndAt: input.salesEndAt,
              salesStartAt: input.salesStartAt,
            })
            .returning(TICKET_TYPE_COLUMNS);
          if (ticketType === undefined) {
            throw new Error('Ticket type insert returned no row');
          }

          const [updatedEvent] = await transaction
            .update(events)
            .set({
              updatedAt: sql`now()`,
              version: sql`${events.version} + 1`,
            })
            .where(
              and(
                eq(events.id, input.eventId),
                eq(events.status, 'draft'),
                eq(events.version, input.expectedVersion),
                isNull(events.retiredAt),
              ),
            )
            .returning({ version: events.version });
          if (updatedEvent === undefined) {
            throw new Error('Locked event changed during ticket type creation');
          }

          await transaction.insert(eventAdminAuditLog).values({
            action: 'event.ticket_type_created',
            actorAdminId: input.actorAdminId,
            eventId: input.eventId,
            eventVersion: updatedEvent.version,
            requestId: input.requestId,
          });

          return {
            outcome: 'created' as const,
            eventVersion: updatedEvent.version,
            ticketType,
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

  list(eventId: string): Promise<EventTicketTypesRecord | undefined> {
    return runWithOperationSpan(
      'event.ticket_type.list',
      async () => {
        const [event] = await this.database
          .select({
            currency: eventTicketConfigurations.currency,
            eventId: events.id,
            eventVersion: events.version,
          })
          .from(events)
          .leftJoin(
            eventTicketConfigurations,
            eq(eventTicketConfigurations.eventId, events.id),
          )
          .where(and(eq(events.id, eventId), isNull(events.retiredAt)))
          .limit(1);
        if (event === undefined) return undefined;

        const ticketTypes: EventTicketTypeRecord[] = await this.database
          .select(TICKET_TYPE_COLUMNS)
          .from(eventTicketTypes)
          .where(eq(eventTicketTypes.eventId, eventId))
          .orderBy(asc(eventTicketTypes.createdAt), asc(eventTicketTypes.id));

        return {
          currency: event.currency,
          eventVersion: event.eventVersion,
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
}
