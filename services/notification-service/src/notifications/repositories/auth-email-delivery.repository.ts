import { randomUUID } from 'node:crypto';

import { runWithOperationSpan } from '@eventa/observability';
import { Inject } from '@nestjs/common';

import { POSTGRES_CLIENT } from '../../database/database.constants';
import type { PostgresClient } from '../../database/database.types';
import {
  AUTH_EMAIL_MAX_DELIVERY_ATTEMPTS,
  AUTH_EMAIL_PROCESSING_LEASE_MS,
} from '../constants/auth-email-delivery.constants';
import type {
  AuthEmailDeliveryClaim,
  AuthEmailDeliveryRepository as AuthEmailDeliveryRepositoryPort,
  AuthEmailDeliveryStatus,
  AuthEmailJob,
} from '../types/auth-email-delivery.types';

interface DeliveryRow {
  attempt_count: number;
  expires_at: Date | string;
  job_type: string;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
  status: AuthEmailDeliveryStatus;
}

interface DatabaseClockRow {
  now: Date | string;
}

const TERMINAL_STATUSES = new Set<AuthEmailDeliveryStatus>([
  'delivered',
  'expired',
  'failed',
  'rejected',
]);

export class AuthEmailDeliveryRepository implements AuthEmailDeliveryRepositoryPort {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly client: PostgresClient,
  ) {}

  claim(job: AuthEmailJob): Promise<AuthEmailDeliveryClaim> {
    return runWithOperationSpan(
      'auth_email_delivery.claim',
      () =>
        this.client.begin(async (sql) => {
          await sql`
            INSERT INTO auth_email_deliveries (
              job_id, job_type, status, expires_at
            )
            VALUES (${job.jobId}, ${job.type}, 'pending', ${job.expiresAt})
            ON CONFLICT (job_id) DO NOTHING
          `;

          const [clock] = await sql<DatabaseClockRow[]>`SELECT NOW() AS now`;
          const [delivery] = await sql<DeliveryRow[]>`
            SELECT attempt_count, expires_at, job_type, lease_expires_at,
                   next_attempt_at, status
            FROM auth_email_deliveries
            WHERE job_id = ${job.jobId}
            FOR UPDATE
          `;

          if (clock === undefined || delivery === undefined) {
            throw new Error('AUTH_EMAIL_DELIVERY_CLAIM_UNAVAILABLE');
          }

          const now = this.timestamp(clock.now);
          const expiresAt = this.timestamp(delivery.expires_at);
          const nowValue = now.toISOString();

          if (
            delivery.job_type !== job.type ||
            expiresAt.toISOString() !== job.expiresAt
          ) {
            return { kind: 'conflict' };
          }

          if (TERMINAL_STATUSES.has(delivery.status)) {
            return {
              kind: 'terminal',
              status: delivery.status as
                'delivered' | 'expired' | 'failed' | 'rejected',
            };
          }

          if (expiresAt <= now) {
            await sql`
              UPDATE auth_email_deliveries
              SET status = 'expired', failure_code = 'JOB_EXPIRED',
                  processing_token = NULL, lease_expires_at = NULL,
                  next_attempt_at = NULL, terminal_at = ${nowValue},
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
            this.timestamp(unavailableUntil) > now
          ) {
            return {
              kind: 'busy',
              retryAt: this.timestamp(unavailableUntil),
            };
          }

          if (delivery.attempt_count >= AUTH_EMAIL_MAX_DELIVERY_ATTEMPTS) {
            await sql`
              UPDATE auth_email_deliveries
              SET status = 'failed', failure_code = 'ATTEMPTS_EXHAUSTED',
                  processing_token = NULL, lease_expires_at = NULL,
                  next_attempt_at = NULL, terminal_at = ${nowValue},
                  updated_at = ${nowValue}
              WHERE job_id = ${job.jobId}
            `;
            return { kind: 'terminal', status: 'failed' };
          }

          const claimToken = randomUUID();
          const leaseExpiresAt = new Date(
            now.getTime() + AUTH_EMAIL_PROCESSING_LEASE_MS,
          ).toISOString();

          await sql`
            UPDATE auth_email_deliveries
            SET status = 'processing',
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
      this.spanOptions('UPDATE'),
    );
  }

  async markDelivered(
    jobId: string,
    claimToken: string,
    providerMessageId: string,
  ): Promise<boolean> {
    const rows = await this.client<{ job_id: string }[]>`
      UPDATE auth_email_deliveries
      SET status = 'delivered', provider_message_id = ${providerMessageId},
          failure_code = NULL, processing_token = NULL,
          lease_expires_at = NULL, next_attempt_at = NULL,
          delivered_at = NOW(), terminal_at = NOW(), updated_at = NOW()
      WHERE job_id = ${jobId} AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING job_id
    `;
    return rows.length === 1;
  }

  async markExpired(jobId: string, claimToken?: string): Promise<boolean> {
    return this.finish(jobId, claimToken, 'expired', 'JOB_EXPIRED');
  }

  async markFailed(
    jobId: string,
    claimToken: string,
    failureCode: string,
  ): Promise<boolean> {
    return this.finish(jobId, claimToken, 'failed', failureCode);
  }

  async markRetryScheduled(
    jobId: string,
    claimToken: string,
    failureCode: string,
    retryAt: Date,
  ): Promise<boolean> {
    const rows = await this.client<{ job_id: string }[]>`
      UPDATE auth_email_deliveries
      SET status = 'retry_scheduled', failure_code = ${failureCode},
          processing_token = NULL, lease_expires_at = NULL,
          next_attempt_at = ${retryAt.toISOString()}, updated_at = NOW()
      WHERE job_id = ${jobId} AND status = 'processing'
        AND processing_token = ${claimToken}
      RETURNING job_id
    `;
    return rows.length === 1;
  }

  async recordRejected(
    jobId: string,
    jobType: string,
    failureCode: string,
  ): Promise<void> {
    await this.client`
      INSERT INTO auth_email_deliveries (
        job_id, job_type, status, attempt_count, failure_code,
        expires_at, terminal_at
      )
      VALUES (
        ${jobId}, ${jobType}, 'rejected', 0, ${failureCode}, NOW(), NOW()
      )
      ON CONFLICT (job_id) DO NOTHING
    `;
  }

  private async finish(
    jobId: string,
    claimToken: string | undefined,
    status: 'expired' | 'failed',
    failureCode: string,
  ): Promise<boolean> {
    const rows =
      claimToken === undefined
        ? await this.client<{ job_id: string }[]>`
            UPDATE auth_email_deliveries
            SET status = ${status}, failure_code = ${failureCode},
                processing_token = NULL, lease_expires_at = NULL,
                next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
            WHERE job_id = ${jobId}
              AND status NOT IN ('delivered', 'failed', 'rejected')
            RETURNING job_id
          `
        : await this.client<{ job_id: string }[]>`
            UPDATE auth_email_deliveries
            SET status = ${status}, failure_code = ${failureCode},
                processing_token = NULL, lease_expires_at = NULL,
                next_attempt_at = NULL, terminal_at = NOW(), updated_at = NOW()
            WHERE job_id = ${jobId} AND status = 'processing'
              AND processing_token = ${claimToken}
            RETURNING job_id
          `;
    return rows.length === 1;
  }

  private timestamp(value: Date | string): Date {
    const timestamp = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      throw new Error('AUTH_EMAIL_DELIVERY_TIMESTAMP_INVALID');
    }

    return timestamp;
  }

  private spanOptions(operation: string): {
    attributes: Record<string, string>;
    kind: 'client';
  } {
    return {
      attributes: {
        'db.collection.name': 'auth_email_deliveries',
        'db.namespace': 'eventa_notification',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client',
    };
  }
}
