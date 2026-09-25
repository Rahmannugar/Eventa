import { runWithOperationSpan } from '@eventa/observability';
import { Inject, Injectable } from '@nestjs/common';

import { POSTGRES_CLIENT } from '../../database/database.constants';
import type { PostgresClient } from '../../database/database.types';
import {
  EVENT_CANCELLATION_EMAIL_JOB_TYPE,
  EVENT_CANCELLATION_EMAIL_QUEUE,
} from '../constants/cancellation-email.constants';
import type {
  RevocationRecord,
  TicketRevokedFact,
} from '../types/cancellation-email.types';

@Injectable()
export class CancellationEmailRepository {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly client: PostgresClient,
  ) {}

  recordRevocation(fact: TicketRevokedFact): Promise<RevocationRecord> {
    return runWithOperationSpan('cancellation_email.record_revocation', () =>
      this.client.begin(async (sql) => {
        const inboxRows = await sql<{ message_id: string }[]>`
          INSERT INTO ticket_revocation_inbox (message_id, event_id, event_type)
          VALUES (${fact.messageId}, ${fact.eventId}, ${fact.type})
          ON CONFLICT (message_id) DO NOTHING
          RETURNING message_id
        `;

        if (inboxRows.length === 0) {
          return { kind: 'duplicate', messageId: fact.messageId } as const;
        }

        const deliveryRows = await sql<{ id: string }[]>`
          INSERT INTO cancellation_email_deliveries (event_id, attendee_id)
          VALUES (${fact.eventId}, ${fact.attendeeId})
          ON CONFLICT (event_id, attendee_id) DO NOTHING
          RETURNING id
        `;

        const delivery = deliveryRows[0];
        if (delivery === undefined) {
          return { kind: 'grouped', messageId: fact.messageId } as const;
        }

        await sql`
          INSERT INTO notification_job_outbox
            (aggregate_type, routing_key, event_type, payload)
          VALUES (
            'eventa.notification.jobs',
            ${EVENT_CANCELLATION_EMAIL_QUEUE},
            ${EVENT_CANCELLATION_EMAIL_JOB_TYPE},
            ${JSON.stringify({
              deliveryId: delivery.id,
              type: EVENT_CANCELLATION_EMAIL_JOB_TYPE,
            })}::jsonb
          )
        `;

        return {
          deliveryId: delivery.id,
          kind: 'created',
          messageId: fact.messageId,
        } as const;
      }),
    );
  }
}
