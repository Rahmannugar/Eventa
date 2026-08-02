import { recordBusinessOutcome } from '@eventa/observability';

import {
  EventMediaNotFoundError,
  EventMediaUploadInProgressError,
  EventNotFoundError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  CreateEventMediaUploadCommand,
  EventMediaManagement,
  EventMediaUploadIntent,
  EventMediaUploadStatusRecord,
  RemoveEventMediaCommand,
} from '../types/event.types';

export class ObservedEventMediaManagement implements EventMediaManagement {
  constructor(private readonly media: EventMediaManagement) {}

  async createUpload(
    input: CreateEventMediaUploadCommand,
  ): Promise<EventMediaUploadIntent> {
    try {
      const upload = await this.media.createUpload(input);
      this.record('created');
      return upload;
    } catch (error: unknown) {
      if (error instanceof EventVersionConflictError) this.record('conflict');
      else if (error instanceof EventNotFoundError) this.record('not_found');
      else if (error instanceof EventMediaUploadInProgressError)
        this.record('in_progress');
      else this.record('failed');
      throw error;
    }
  }

  getUploadStatus(
    eventId: string,
    uploadId: string,
  ): Promise<EventMediaUploadStatusRecord> {
    return this.media.getUploadStatus(eventId, uploadId);
  }

  async remove(input: RemoveEventMediaCommand): Promise<number> {
    try {
      const version = await this.media.remove(input);
      this.recordRemoval('removed');
      return version;
    } catch (error: unknown) {
      if (error instanceof EventVersionConflictError)
        this.recordRemoval('conflict');
      else if (error instanceof EventNotFoundError)
        this.recordRemoval('not_found');
      else if (error instanceof EventMediaNotFoundError)
        this.recordRemoval('media_not_found');
      else this.recordRemoval('failed');
      throw error;
    }
  }

  private record(
    outcome: 'created' | 'conflict' | 'not_found' | 'in_progress' | 'failed',
  ): void {
    recordBusinessOutcome({ operation: 'event.media_upload_intent', outcome });
  }

  private recordRemoval(
    outcome:
      'removed' | 'conflict' | 'not_found' | 'media_not_found' | 'failed',
  ): void {
    recordBusinessOutcome({ operation: 'event.media_remove', outcome });
  }
}
