import { Inject } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';
import { eq } from 'drizzle-orm';

import { EVENT_DATABASE } from '../../database/database.constants';
import type { EventDatabase } from '../../database/database.types';
import { eventAdminAuditLog } from '../schema/event-admin-audit.schema';
import { events } from '../schema/event.schema';
import type {
  CreateDraftEvent,
  EventRecord,
  EventRepository as EventRepositoryPort,
} from '../types/event.types';

export class EventRepository implements EventRepositoryPort {
  constructor(
    @Inject(EVENT_DATABASE)
    private readonly database: EventDatabase,
  ) {}

  createDraft(input: CreateDraftEvent): Promise<EventRecord> {
    return runWithOperationSpan(
      'event.create_draft',
      () =>
        this.database.transaction(async (transaction) => {
          const [event] = await transaction
            .insert(events)
            .values({
              createdByAdminId: input.actorAdminId,
              title: input.title,
            })
            .returning({
              eventId: events.id,
              title: events.title,
              status: events.status,
              createdByAdminId: events.createdByAdminId,
              createdAt: events.createdAt,
              updatedAt: events.updatedAt,
            });

          if (event === undefined) {
            throw new Error('Event insert returned no row');
          }

          await transaction.insert(eventAdminAuditLog).values({
            action: 'event.created',
            actorAdminId: input.actorAdminId,
            eventId: event.eventId,
            requestId: input.requestId,
          });

          return event;
        }),
      this.spanOptions('INSERT'),
    );
  }

  findById(eventId: string): Promise<EventRecord | undefined> {
    return runWithOperationSpan(
      'event.find_by_id',
      async () => {
        const [event] = await this.database
          .select({
            eventId: events.id,
            title: events.title,
            status: events.status,
            createdByAdminId: events.createdByAdminId,
            createdAt: events.createdAt,
            updatedAt: events.updatedAt,
          })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1);

        return event;
      },
      this.spanOptions('SELECT'),
    );
  }

  private spanOptions(operation: string): {
    attributes: Record<string, string>;
    kind: 'client';
  } {
    return {
      attributes: {
        'db.collection.name': 'events',
        'db.namespace': 'eventa_event',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client',
    };
  }
}
