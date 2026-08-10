import { Inject } from '@nestjs/common';

import { POSTGRES_CLIENT } from '../../database/database.constants';
import type { PostgresClient } from '../../database/database.types';
import type {
  ClaimedEventPublication,
  EventPublicationOutbox,
} from '../types/event.types';

interface ClaimedRow {
  attempt_count: number;
  claim_token: string;
  payload: ClaimedEventPublication['fact'];
}

export class EventPublicationOutboxRepository implements EventPublicationOutbox {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly postgres: PostgresClient,
  ) {}

  async claimBatch(
    limit: number,
    claimTtlMs: number,
  ): Promise<ClaimedEventPublication[]> {
    const rows = await this.postgres<ClaimedRow[]>`
      WITH candidates AS (
        SELECT event_id
        FROM event_publication_outbox
        WHERE published_at IS NULL
          AND next_attempt_at <= NOW()
          AND (claim_expires_at IS NULL OR claim_expires_at <= NOW())
        ORDER BY occurred_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE event_publication_outbox AS event
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
      fact: row.payload,
    }));
  }

  async markPublished(eventId: string, claimToken: string): Promise<boolean> {
    const rows = await this.postgres`
      UPDATE event_publication_outbox
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
      UPDATE event_publication_outbox
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
