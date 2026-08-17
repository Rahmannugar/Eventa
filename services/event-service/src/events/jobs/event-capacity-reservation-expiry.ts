import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';

import {
  EVENT_CAPACITY_EXPIRY_BATCH_SIZE,
  EVENT_CAPACITY_EXPIRY_INTERVAL_MS,
} from '../constants/event.constants';
import type { EventCapacityReservationRepository } from '../types/event.types';

export class EventCapacityReservationExpiry
  implements OnModuleInit, OnApplicationShutdown
{
  private expiring = false;
  private readonly logger = new Logger(EventCapacityReservationExpiry.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly reservations: EventCapacityReservationRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.expireDue(),
      EVENT_CAPACITY_EXPIRY_INTERVAL_MS,
    );
    this.timer.unref();
    void this.expireDue();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async expireDue(): Promise<void> {
    if (this.expiring) return;
    this.expiring = true;
    try {
      const reservationIds = await this.reservations.findDue(
        EVENT_CAPACITY_EXPIRY_BATCH_SIZE,
      );
      for (const reservationId of reservationIds) {
        try {
          await this.reservations.expire(reservationId);
        } catch (error: unknown) {
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'event_capacity_reservation_expiry_failed',
            operation: 'event.capacity.expire',
            reservation_id: reservationId,
          });
        }
      }
    } catch (error: unknown) {
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'event_capacity_reservation_expiry_failed',
        operation: 'event.capacity.expire_due',
      });
    } finally {
      this.expiring = false;
    }
  }
}
