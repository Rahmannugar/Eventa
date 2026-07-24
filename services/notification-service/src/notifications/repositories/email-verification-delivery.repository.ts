import { randomUUID } from 'node:crypto';

import type { AttendeeEmailVerificationJob } from '@eventa/messaging-contracts';
import { runWithOperationSpan } from '@eventa/observability';
import { Inject } from '@nestjs/common';

import { POSTGRES_CLIENT } from '../../database/database.constants';
import type { PostgresClient } from '../../database/database.types';
import {
  EMAIL_VERIFICATION_MAX_DELIVERY_ATTEMPTS,
  EMAIL_VERIFICATION_PROCESSING_LEASE_MS,
} from '../constants/email-verification-delivery.constants';
import type {
  EmailVerificationDeliveryClaim,
  EmailVerificationDeliveryRepository as EmailVerificationDeliveryRepositoryPort,
  EmailVerificationDeliveryStatus,
} from '../types/email-verification-delivery.types';

interface DeliveryRow {
  attempt_count: number;
  expires_at: Date | string;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
  status: EmailVerificationDeliveryStatus;
}

interface DatabaseClockRow {
  now: Date | string;
}

const TERMINAL_STATUSES = new Set<EmailVerificationDeliveryStatus>([
  'delivered',
  'expired',
  'failed',
  'rejected',
]);

export class EmailVerificationDeliveryRepository implements EmailVerificationDeliveryRepositoryPort {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly client: PostgresClient,
  ) {}

  async claim(
    job: AttendeeEmailVerificationJob,
  ): Promise<EmailVerificationDeliveryClaim> {
    return runWithOperationSpan(
      'email_verification_delivery.claim',
      () =>
        this.client.begin(async (sql) => {
          await sql`
            INSERT INTO email_verification_deliveries (
              job_id,
              job_type,
              status,
              expires_at
            )
            VALUES (
              ${job.jobId},
              ${job.type},
              'pending',
              ${job.expiresAt}
            )
            ON CONFLICT (job_id) DO NOTHING
          `;

          const [clock] = await sql<DatabaseClockRow[]>`
            SELECT NOW() AS now
          `;
          const [delivery] = await sql<DeliveryRow[]>`
            SELECT
              attempt_count,
              expires_at,
              lease_expires_at,
              next_attempt_at,
              status
            FROM email_verification_deliveries
            WHERE job_id = ${job.jobId}
            FOR UPDATE
          `;

          if (clock === undefined || delivery === undefined) {
            throw new Error('EMAIL_VERIFICATION_DELIVERY_CLAIM_UNAVAILABLE');
          }

          const now = this.readDatabaseTimestamp(clock.now);
          const expiresAt = this.readDatabaseTimestamp(delivery.expires_at);
          const nowValue = now.toISOString();

          if (expiresAt.toISOString() !== job.expiresAt) {
            return { kind: 'conflict' };
          }

          if (TERMINAL_STATUSES.has(delivery.status)) {
            return {
              kind: 'terminal',
              status: delivery.status as Extract<
                EmailVerificationDeliveryStatus,
                'delivered' | 'expired' | 'failed' | 'rejected'
              >,
            };
          }

          if (expiresAt <= now) {
            await sql`
              UPDATE email_verification_deliveries
              SET
                status = 'expired',
                failure_code = 'JOB_EXPIRED',
                processing_token = NULL,
                lease_expires_at = NULL,
                next_attempt_at = NULL,
                terminal_at = ${nowValue},
                updated_at = ${nowValue}
              WHERE job_id = ${job.jobId}
            `;
            return { kind: 'terminal', status: 'expired' };
          }

          const unavailableUntil =
            delivery.status === 'processing'
              ? delivery.lease_expires_at
              : delivery.status === 'retry_scheduled'
                ? delivery.next_attempt_at
                : null;

          if (
            unavailableUntil !== null &&
            this.readDatabaseTimestamp(unavailableUntil).getTime() >
              now.getTime()
          ) {
            return {
              kind: 'busy',
              retryAt: this.readDatabaseTimestamp(unavailableUntil),
            };
          }

          if (
            delivery.attempt_count >= EMAIL_VERIFICATION_MAX_DELIVERY_ATTEMPTS
          ) {
            await sql`
              UPDATE email_verification_deliveries
              SET
                status = 'failed',
                failure_code = 'ATTEMPTS_EXHAUSTED',
                processing_token = NULL,
                lease_expires_at = NULL,
                next_attempt_at = NULL,
                terminal_at = ${nowValue},
                updated_at = ${nowValue}
              WHERE job_id = ${job.jobId}
            `;
            return { kind: 'terminal', status: 'failed' };
          }

          const claimToken = randomUUID();
          const leaseExpiresAt = new Date(
            now.getTime() + EMAIL_VERIFICATION_PROCESSING_LEASE_MS,
          ).toISOString();

          await sql`
            UPDATE email_verification_deliveries
            SET
              status = 'processing',
              attempt_count = attempt_count + 1,
              failure_code = NULL,
              processing_token = ${claimToken},
              lease_expires_at = ${leaseExpiresAt},
              next_attempt_at = NULL,
              updated_at = ${nowValue}
            WHERE job_id = ${job.jobId}
          `;

          return {
            attempt: delivery.attempt_count + 1,
            claimToken,
            kind: 'claimed',
          };
        }),
      this.databaseSpanOptions('UPDATE'),
    );
  }

  async markDelivered(
    jobId: string,
    claimToken: string,
    providerMessageId: string,
  ): Promise<boolean> {
    const rows = await this.client<{ job_id: string }[]>`
      UPDATE email_verification_deliveries
      SET
        status = 'delivered',
        provider_message_id = ${providerMessageId},
        failure_code = NULL,
        processing_token = NULL,
        lease_expires_at = NULL,
        next_attempt_at = NULL,
        delivered_at = NOW(),
        terminal_at = NOW(),
        updated_at = NOW()
      WHERE
        job_id = ${jobId}
        AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING job_id
    `;

    return rows.length === 1;
  }

  async markExpired(jobId: string, claimToken?: string): Promise<boolean> {
    const rows =
      claimToken === undefined
        ? await this.client<{ job_id: string }[]>`
            UPDATE email_verification_deliveries
            SET
              status = 'expired',
              failure_code = 'JOB_EXPIRED',
              processing_token = NULL,
              lease_expires_at = NULL,
              next_attempt_at = NULL,
              terminal_at = NOW(),
              updated_at = NOW()
            WHERE
              job_id = ${jobId}
              AND status NOT IN ('delivered', 'failed', 'rejected')
            RETURNING job_id
          `
        : await this.client<{ job_id: string }[]>`
            UPDATE email_verification_deliveries
            SET
              status = 'expired',
              failure_code = 'JOB_EXPIRED',
              processing_token = NULL,
              lease_expires_at = NULL,
              next_attempt_at = NULL,
              terminal_at = NOW(),
              updated_at = NOW()
            WHERE
              job_id = ${jobId}
              AND status = 'processing'
              AND processing_token = ${claimToken}
            RETURNING job_id
          `;

    return rows.length === 1;
  }

  async markFailed(
    jobId: string,
    claimToken: string,
    failureCode: string,
  ): Promise<boolean> {
    const rows = await this.client<{ job_id: string }[]>`
      UPDATE email_verification_deliveries
      SET
        status = 'failed',
        failure_code = ${failureCode},
        processing_token = NULL,
        lease_expires_at = NULL,
        next_attempt_at = NULL,
        terminal_at = NOW(),
        updated_at = NOW()
      WHERE
        job_id = ${jobId}
        AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING job_id
    `;

    return rows.length === 1;
  }

  async markRetryScheduled(
    jobId: string,
    claimToken: string,
    failureCode: string,
    retryAt: Date,
  ): Promise<boolean> {
    const rows = await this.client<{ job_id: string }[]>`
      UPDATE email_verification_deliveries
      SET
        status = 'retry_scheduled',
        failure_code = ${failureCode},
        processing_token = NULL,
        lease_expires_at = NULL,
        next_attempt_at = ${retryAt.toISOString()},
        updated_at = NOW()
      WHERE
        job_id = ${jobId}
        AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING job_id
    `;

    return rows.length === 1;
  }

  async recordRejected(jobId: string, failureCode: string): Promise<void> {
    await this.client`
      INSERT INTO email_verification_deliveries (
        job_id,
        job_type,
        status,
        attempt_count,
        failure_code,
        expires_at,
        terminal_at
      )
      VALUES (
        ${jobId},
        'attendee.email-verification.v1',
        'rejected',
        0,
        ${failureCode},
        NOW(),
        NOW()
      )
      ON CONFLICT (job_id) DO NOTHING
    `;
  }

  private databaseSpanOptions(operation: string): {
    attributes: Record<string, string>;
    kind: 'client';
  } {
    return {
      attributes: {
        'db.collection.name': 'email_verification_deliveries',
        'db.namespace': 'eventa_notification',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client',
    };
  }

  private readDatabaseTimestamp(value: Date | string): Date {
    const timestamp = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      throw new Error('EMAIL_VERIFICATION_DELIVERY_TIMESTAMP_INVALID');
    }

    return timestamp;
  }
}
