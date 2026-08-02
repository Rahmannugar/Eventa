import { randomUUID } from 'node:crypto';

import {
  EVENT_MEDIA_CLAIM_LEASE_MS,
  EVENT_MEDIA_RETRY_DELAYS_MS,
} from '../constants/event-media.constants';
import type {
  EventMediaObjectDeletionRepository,
  EventMediaObjectStorage,
} from '../types/event.types';

export type EventMediaObjectDeletionOutcome =
  | { kind: 'completed' }
  | { kind: 'deleted' }
  | { kind: 'retry'; retryAt: Date }
  | { kind: 'object_deletion_failed' };

export class EventMediaObjectDeletionService {
  constructor(
    private readonly deletions: EventMediaObjectDeletionRepository,
    private readonly objects: EventMediaObjectStorage,
  ) {}

  async delete(deletionId: string): Promise<EventMediaObjectDeletionOutcome> {
    const claimToken = randomUUID();
    const deletion = await this.deletions.claim(
      deletionId,
      claimToken,
      new Date(Date.now() + EVENT_MEDIA_CLAIM_LEASE_MS),
    );
    if (deletion === undefined) return { kind: 'completed' };

    try {
      await this.objects.delete(deletion.objectKey);
      await this.deletions.markDeleted(deletionId, claimToken);
      return { kind: 'deleted' };
    } catch {
      const index = Math.min(
        deletion.attemptCount,
        EVENT_MEDIA_RETRY_DELAYS_MS.length - 1,
      );
      const retryAt = new Date(
        Date.now() + EVENT_MEDIA_RETRY_DELAYS_MS[index]!,
      );
      const outcome = await this.deletions.recordFailure(
        deletionId,
        claimToken,
        retryAt,
      );
      return outcome === 'failed'
        ? { kind: 'object_deletion_failed' }
        : { kind: 'retry', retryAt };
    }
  }
}
