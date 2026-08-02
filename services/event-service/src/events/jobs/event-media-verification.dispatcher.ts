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
  EventMediaUploadRepository,
  EventMediaVerificationJobPublisher,
} from '../types/event.types';

export class EventMediaVerificationDispatcher
  implements OnModuleInit, OnApplicationShutdown
{
  private dispatching = false;
  private readonly logger = new Logger(EventMediaVerificationDispatcher.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly uploads: EventMediaUploadRepository,
    private readonly jobs: EventMediaVerificationJobPublisher,
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
      const uploadIds = await this.uploads.claimDispatchable(
        EVENT_MEDIA_DISPATCH_BATCH_SIZE,
        new Date(Date.now() - EVENT_MEDIA_DISPATCH_LEASE_MS),
      );
      await Promise.all(
        uploadIds.map((uploadId) => this.publishClaimedUpload(uploadId)),
      );
    } catch (error: unknown) {
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'event_media_verification_dispatcher_error',
      });
    } finally {
      this.dispatching = false;
    }
  }

  private async publishClaimedUpload(uploadId: string): Promise<void> {
    try {
      await this.jobs.publish(uploadId);
    } catch (error: unknown) {
      this.logger.error({
        error_type: error instanceof Error ? error.name : 'UnknownError',
        event: 'event_media_verification_dispatch_failed',
        job_id: uploadId,
        upload_id: uploadId,
      });
      try {
        await this.uploads.markDispatchFailed(uploadId);
      } catch (recoveryError: unknown) {
        this.logger.error({
          error_type:
            recoveryError instanceof Error
              ? recoveryError.name
              : 'UnknownError',
          event: 'event_media_verification_dispatch_recovery_failed',
          job_id: uploadId,
          upload_id: uploadId,
        });
      }
    }
  }
}
