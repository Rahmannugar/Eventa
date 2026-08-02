import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';

import {
  EVENT_MEDIA_DISPATCH_BATCH_SIZE,
  EVENT_MEDIA_DISPATCH_INTERVAL_MS,
  EVENT_MEDIA_DISPATCH_LEASE_MS,
} from '../constants/event-media.constants';
import type {
  EventMediaObjectDeletionJobPublisher,
  EventMediaObjectDeletionRepository,
} from '../types/event.types';

export class EventMediaObjectDeletionDispatcher
  implements OnModuleInit, OnApplicationShutdown
{
  private dispatching = false;
  private readonly logger = new Logger(EventMediaObjectDeletionDispatcher.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly deletions: EventMediaObjectDeletionRepository,
    private readonly jobs: EventMediaObjectDeletionJobPublisher,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.dispatch(),
      EVENT_MEDIA_DISPATCH_INTERVAL_MS,
    );
    this.timer.unref();
    void this.dispatch();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async dispatch(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const deletionIds = await this.deletions.claimDispatchable(
        EVENT_MEDIA_DISPATCH_BATCH_SIZE,
        new Date(Date.now() - EVENT_MEDIA_DISPATCH_LEASE_MS),
      );
      await Promise.all(
        deletionIds.map((deletionId) => this.publish(deletionId)),
      );
    } catch (error: unknown) {
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'event_media_object_deletion_dispatcher_error',
      });
    } finally {
      this.dispatching = false;
    }
  }

  private async publish(deletionId: string): Promise<void> {
    try {
      await this.jobs.publish(deletionId);
    } catch (error: unknown) {
      this.logger.error({
        deletion_id: deletionId,
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'event_media_object_deletion_dispatch_failed',
        job_id: deletionId,
      });
      try {
        await this.deletions.markDispatchFailed(deletionId);
      } catch (recoveryError: unknown) {
        this.logger.error({
          deletion_id: deletionId,
          error_type:
            recoveryError instanceof Error
              ? recoveryError.name
              : 'UnknownError',
          event: 'event_media_object_deletion_dispatch_recovery_failed',
          job_id: deletionId,
        });
      }
    }
  }
}
