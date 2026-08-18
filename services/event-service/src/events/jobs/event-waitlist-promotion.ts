import {
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import {
  EVENT_WAITLIST_PROMOTION_BATCH_SIZE,
  EVENT_WAITLIST_PROMOTION_INTERVAL_MS,
} from '../constants/event.constants';
import type { EventWaitlistRepository } from '../types/event.types';

export class EventWaitlistPromotion implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventWaitlistPromotion.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private cursor: string | null = null;

  constructor(private readonly waitlist: EventWaitlistRepository) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.sweep(),
      EVENT_WAITLIST_PROMOTION_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let ticketTypeIds = await this.waitlist.findPromotionCandidates(
        this.cursor,
        EVENT_WAITLIST_PROMOTION_BATCH_SIZE,
      );
      if (ticketTypeIds.length === 0 && this.cursor !== null) {
        this.cursor = null;
        ticketTypeIds = await this.waitlist.findPromotionCandidates(
          null,
          EVENT_WAITLIST_PROMOTION_BATCH_SIZE,
        );
      }
      for (const ticketTypeId of ticketTypeIds) {
        await this.waitlist.promote(
          ticketTypeId,
          EVENT_WAITLIST_PROMOTION_BATCH_SIZE,
        );
        this.cursor = ticketTypeId;
      }
    } catch {
      this.logger.error({ event: 'event_waitlist_promotion_failed' });
    } finally {
      this.running = false;
    }
  }
}
