import {
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { recordBusinessOutcome } from '@eventa/observability';

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
        try {
          const promoted = await this.waitlist.promote(
            ticketTypeId,
            EVENT_WAITLIST_PROMOTION_BATCH_SIZE,
          );
          if (promoted > 0) {
            recordBusinessOutcome({
              operation: 'event.waitlist_promotion',
              outcome: 'promoted',
            });
          }
        } catch (error: unknown) {
          recordBusinessOutcome({
            operation: 'event.waitlist_promotion',
            outcome: 'failed',
          });
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'event_waitlist_promotion_failed',
            operation: 'event.waitlist.promote',
            ticket_type_id: ticketTypeId,
          });
        } finally {
          this.cursor = ticketTypeId;
        }
      }
    } catch (error: unknown) {
      recordBusinessOutcome({
        operation: 'event.waitlist_promotion',
        outcome: 'sweep_failed',
      });
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'event_waitlist_promotion_sweep_failed',
        operation: 'event.waitlist.find_promotion_candidates',
      });
    } finally {
      this.running = false;
    }
  }
}
