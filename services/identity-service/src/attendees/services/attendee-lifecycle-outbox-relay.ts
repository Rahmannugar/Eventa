import {
  Inject,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import {
  ATTENDEE_LIFECYCLE_EVENT_PUBLISHER,
  ATTENDEE_LIFECYCLE_OUTBOX,
  ATTENDEE_LIFECYCLE_OUTBOX_BATCH_SIZE,
  ATTENDEE_LIFECYCLE_OUTBOX_CLAIM_TTL_MS,
  ATTENDEE_LIFECYCLE_OUTBOX_POLL_INTERVAL_MS,
} from '../constants/attendee-deletion.constants';
import type { AttendeeLifecycleEventPublisher } from '../ports/attendee-lifecycle-event.publisher';
import type { AttendeeLifecycleOutbox } from '../types/attendee-deletion.types';

const MAX_RETRY_DELAY_MS = 60_000;

export class AttendeeLifecycleOutboxRelay
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AttendeeLifecycleOutboxRelay.name);
  private stopped = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ATTENDEE_LIFECYCLE_OUTBOX)
    private readonly outbox: AttendeeLifecycleOutbox,
    @Inject(ATTENDEE_LIFECYCLE_EVENT_PUBLISHER)
    private readonly publisher: AttendeeLifecycleEventPublisher,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
  }

  private schedule(delayMs: number): void {
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.poll(), delayMs);
    }
  }

  private async poll(): Promise<void> {
    try {
      const events = await this.outbox.claimBatch(
        ATTENDEE_LIFECYCLE_OUTBOX_BATCH_SIZE,
        ATTENDEE_LIFECYCLE_OUTBOX_CLAIM_TTL_MS,
      );

      for (const claimed of events) {
        try {
          await this.publisher.publishDeleted(claimed.event);
          await this.outbox.markPublished(
            claimed.event.eventId,
            claimed.claimToken,
          );
        } catch {
          const retryDelay = Math.min(
            1_000 * 2 ** Math.min(claimed.attempt - 1, 6),
            MAX_RETRY_DELAY_MS,
          );
          await this.outbox.scheduleRetry(
            claimed.event.eventId,
            claimed.claimToken,
            'EVENT_BUS_PUBLISH_FAILED',
            new Date(Date.now() + retryDelay),
          );
          this.logger.warn({
            eventId: claimed.event.eventId,
            message: 'Attendee lifecycle event publication will be retried',
          });
        }
      }
    } catch {
      this.logger.warn('Attendee lifecycle outbox polling will be retried');
    } finally {
      this.schedule(ATTENDEE_LIFECYCLE_OUTBOX_POLL_INTERVAL_MS);
    }
  }
}
