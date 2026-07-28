import { Inject } from '@nestjs/common';

import { POSTGRES_CLIENT } from '../../database/database.constants';
import type { PostgresClient } from '../../database/database.types';
import type {
  AttendeeLifecycleOutbox,
  ClaimedAttendeeLifecycleEvent,
} from '../types/attendee-deletion.types';

interface ClaimedRow {
  attempt_count: number;
  claim_token: string;
  payload: ClaimedAttendeeLifecycleEvent['event'];
}

export class AttendeeLifecycleOutboxRepository implements AttendeeLifecycleOutbox {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly postgres: PostgresClient,
  ) {}

  async claimBatch(
    limit: number,
    claimTtlMs: number,
  ): Promise<ClaimedAttendeeLifecycleEvent[]> {
    const rows = await this.postgres<ClaimedRow[]>`
      WITH candidates AS (
        SELECT event_id
        FROM attendee_lifecycle_outbox
        WHERE published_at IS NULL
          AND next_attempt_at <= NOW()
          AND (claim_expires_at IS NULL OR claim_expires_at <= NOW())
        ORDER BY occurred_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE attendee_lifecycle_outbox AS event
      SET claim_token = gen_random_uuid(),
          claim_expires_at = NOW() + (${claimTtlMs} * INTERVAL '1 millisecond'),
          attempt_count = event.attempt_count + 1
      FROM candidates
      WHERE event.event_id = candidates.event_id
      RETURNING event.attempt_count, event.claim_token, event.payload
    `;

    return rows.map((row) => ({
      attempt: row.attempt_count,
      claimToken: row.claim_token,
      event: row.payload,
    }));
  }

  async markPublished(eventId: string, claimToken: string): Promise<boolean> {
    const rows = await this.postgres`
      UPDATE attendee_lifecycle_outbox
      SET published_at = NOW(),
          claim_token = NULL,
          claim_expires_at = NULL,
          last_error_code = NULL
      WHERE event_id = ${eventId}
        AND claim_token = ${claimToken}
        AND published_at IS NULL
      RETURNING event_id
    `;
    return rows.length === 1;
  }

  async scheduleRetry(
    eventId: string,
    claimToken: string,
    errorCode: string,
    retryAt: Date,
  ): Promise<boolean> {
    const rows = await this.postgres`
      UPDATE attendee_lifecycle_outbox
      SET claim_token = NULL,
          claim_expires_at = NULL,
          last_error_code = ${errorCode},
          next_attempt_at = ${retryAt.toISOString()}::timestamptz
      WHERE event_id = ${eventId}
        AND claim_token = ${claimToken}
        AND published_at IS NULL
      RETURNING event_id
    `;
    return rows.length === 1;
  }
}
