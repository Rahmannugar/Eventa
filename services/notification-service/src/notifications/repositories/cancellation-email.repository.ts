import { runWithOperationSpan } from '@eventa/observability';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { POSTGRES_CLIENT } from '../../database/database.constants';
import type { PostgresClient } from '../../database/database.types';
import {
  EVENT_CANCELLATION_EMAIL_JOB_TYPE,
  EVENT_CANCELLATION_EMAIL_MAX_DELIVERY_ATTEMPTS,
  EVENT_CANCELLATION_EMAIL_PROCESSING_LEASE_MS,
  EVENT_CANCELLATION_EMAIL_QUEUE,
} from '../constants/cancellation-email.constants';
import type {
  CancellationEmailClaim,
  CancellationEmailDeliveryRepository as CancellationEmailDeliveryRepositoryPort,
  CancellationEmailDeliveryStatus,
  RevocationRecord,
  TicketRevokedFact,
} from '../types/cancellation-email.types';

interface DeliveryRow {
  attendee_id: string;
  attempt_count: number;
  event_id: string;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
  status: CancellationEmailDeliveryStatus;
}

interface DatabaseClockRow {
  now: Date | string;
}

const TERMINAL_STATUSES = new Set<CancellationEmailDeliveryStatus>([
  'delivered',
  'failed',
  'rejected',
]);

@Injectable()
export class CancellationEmailRepository implements CancellationEmailDeliveryRepositoryPort {
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

  claim(deliveryId: string): Promise<CancellationEmailClaim> {
    return runWithOperationSpan(
      'cancellation_email.claim',
      () =>
        this.client.begin(async (sql) => {
          const [clock] = await sql<DatabaseClockRow[]>`SELECT NOW() AS now`;
          const [delivery] = await sql<DeliveryRow[]>`
            SELECT attendee_id, attempt_count, event_id, lease_expires_at,
                   next_attempt_at, status
            FROM cancellation_email_deliveries
            WHERE id = ${deliveryId}
            FOR UPDATE
          `;

          if (clock === undefined || delivery === undefined) {
            return { kind: 'terminal', status: 'failed' } as const;
          }

          const now = this.timestamp(clock.now);
          const nowValue = now.toISOString();

          if (TERMINAL_STATUSES.has(delivery.status)) {
            return {
              kind: 'terminal',
              status: delivery.status as 'delivered' | 'failed' | 'rejected',
            } as const;
          }

          const unavailableUntil =
            delivery.status === 'processing'
              ? delivery.lease_expires_at
              : delivery.status === 'retry_scheduled'
                ? delivery.next_attempt_at
                : null;

          if (
            unavailableUntil !== null &&
            this.timestamp(unavailableUntil) > now
          ) {
            return {
              kind: 'busy',
              retryAt: this.timestamp(unavailableUntil),
            } as const;
          }

          if (
            delivery.attempt_count >=
            EVENT_CANCELLATION_EMAIL_MAX_DELIVERY_ATTEMPTS
          ) {
            await sql`
              UPDATE cancellation_email_deliveries
              SET status = 'failed', failure_code = 'ATTEMPTS_EXHAUSTED',
                  processing_token = NULL, lease_expires_at = NULL,
                  next_attempt_at = NULL, terminal_at = ${nowValue},
                  updated_at = ${nowValue}
              WHERE id = ${deliveryId}
            `;
            return { kind: 'terminal', status: 'failed' } as const;
          }

          const claimToken = randomUUID();
          const leaseExpiresAt = new Date(
            now.getTime() + EVENT_CANCELLATION_EMAIL_PROCESSING_LEASE_MS,
          ).toISOString();

          await sql`
            UPDATE cancellation_email_deliveries
            SET status = 'processing',
                attempt_count = attempt_count + 1,
                failure_code = NULL,
                processing_token = ${claimToken},
                lease_expires_at = ${leaseExpiresAt},
                next_attempt_at = NULL,
                updated_at = ${nowValue}
            WHERE id = ${deliveryId}
          `;

          return {
            attendeeId: delivery.attendee_id,
            attempt: delivery.attempt_count + 1,
            claimToken,
            eventId: delivery.event_id,
            kind: 'claimed',
          } as const;
        }),
      this.spanOptions('UPDATE'),
    );
  }

  async markDelivered(
    deliveryId: string,
    claimToken: string,
    providerMessageId: string,
  ): Promise<boolean> {
    const rows = await this.client<{ id: string }[]>`
      UPDATE cancellation_email_deliveries
      SET status = 'delivered', provider_message_id = ${providerMessageId},
          failure_code = NULL, processing_token = NULL,
          lease_expires_at = NULL, next_attempt_at = NULL,
          delivered_at = NOW(), terminal_at = NOW(), updated_at = NOW()
      WHERE id = ${deliveryId} AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING id
    `;
    return rows.length === 1;
  }

  async markFailed(
    deliveryId: string,
    claimToken: string,
    failureCode: string,
  ): Promise<boolean> {
    return this.finish(deliveryId, claimToken, 'failed', failureCode);
  }

  async markRetryScheduled(
    deliveryId: string,
    claimToken: string,
    failureCode: string,
    retryAt: Date,
  ): Promise<boolean> {
    const rows = await this.client<{ id: string }[]>`
      UPDATE cancellation_email_deliveries
      SET status = 'retry_scheduled', failure_code = ${failureCode},
          processing_token = NULL, lease_expires_at = NULL,
          next_attempt_at = ${retryAt.toISOString()}, updated_at = NOW()
      WHERE id = ${deliveryId} AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING id
    `;
    return rows.length === 1;
  }

  async recordRejected(deliveryId: string, failureCode: string): Promise<void> {
    await this.client`
      UPDATE cancellation_email_deliveries
      SET status = 'rejected', failure_code = ${failureCode},
          processing_token = NULL, lease_expires_at = NULL,
          next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
      WHERE id = ${deliveryId}
        AND status NOT IN ('delivered', 'failed', 'rejected')
    `;
  }

  private async finish(
    deliveryId: string,
    claimToken: string,
    status: 'failed',
    failureCode: string,
  ): Promise<boolean> {
    const rows = await this.client<{ id: string }[]>`
      UPDATE cancellation_email_deliveries
      SET status = ${status}, failure_code = ${failureCode},
          processing_token = NULL, lease_expires_at = NULL,
          next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
      WHERE id = ${deliveryId} AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING id
    `;
    return rows.length === 1;
  }

  private timestamp(value: Date | string): Date {
    const timestamp = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      throw new Error('CANCELLATION_EMAIL_TIMESTAMP_INVALID');
    }

    return timestamp;
  }

  private spanOptions(operation: string): {
    attributes: Record<string, string>;
    kind: 'client';
  } {
    return {
      attributes: {
        'db.collection.name': 'cancellation_email_deliveries',
        'db.namespace': 'eventa_notification',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client',
    };
  }
}
