import {
  Inject,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import {
  EVENT_PUBLISHER,
  EVENT_PUBLICATION_OUTBOX,
  EVENT_PUBLICATION_OUTBOX_BATCH_SIZE,
  EVENT_PUBLICATION_OUTBOX_CLAIM_TTL_MS,
  EVENT_PUBLICATION_OUTBOX_POLL_INTERVAL_MS,
} from '../constants/event.constants';
import type {
  EventPublisher,
  EventPublicationOutbox,
} from '../types/event.types';

const MAX_RETRY_DELAY_MS = 60_000;

export class EventPublicationOutboxRelay
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(EventPublicationOutboxRelay.name);
  private stopped = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(EVENT_PUBLICATION_OUTBOX)
    private readonly outbox: EventPublicationOutbox,
    @Inject(EVENT_PUBLISHER)
    private readonly publisher: EventPublisher,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.poll(), delayMs);
    }
  }

  private async poll(): Promise<void> {
    try {
      const publications = await this.outbox.claimBatch(
        EVENT_PUBLICATION_OUTBOX_BATCH_SIZE,
        EVENT_PUBLICATION_OUTBOX_CLAIM_TTL_MS,
      );

      for (const claimed of publications) {
        try {
          await this.publisher.publish(claimed.fact);
          await this.outbox.markPublished(
            claimed.fact.eventId,
            claimed.claimToken,
          );
        } catch {
          const retryDelay = Math.min(
            1_000 * 2 ** Math.min(claimed.attempt - 1, 6),
            MAX_RETRY_DELAY_MS,
          );
          await this.outbox.scheduleRetry(
            claimed.fact.eventId,
            claimed.claimToken,
            'EVENT_BUS_PUBLISH_FAILED',
            new Date(Date.now() + retryDelay),
          );
          this.logger.warn({
            event: 'event.publication_retry_scheduled',
            eventId: claimed.fact.eventId,
          });
        }
      }
    } catch {
      this.logger.warn({ event: 'event.publication_outbox_poll_retry' });
    } finally {
      this.schedule(EVENT_PUBLICATION_OUTBOX_POLL_INTERVAL_MS);
    }
  }
}
