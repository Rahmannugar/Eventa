import { recordBusinessOutcome } from '@eventa/observability';

import {
  EventMediaSlotOccupiedError,
  EventMediaUploadInProgressError,
  EventNotFoundError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  CreateEventMediaUploadCommand,
  EventMediaManagement,
  EventMediaUploadIntent,
  EventMediaUploadStatusRecord,
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
      else if (error instanceof EventMediaSlotOccupiedError)
        this.record('slot_occupied');
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

  private record(
    outcome:
      | 'created'
      | 'conflict'
      | 'not_found'
      | 'slot_occupied'
      | 'in_progress'
      | 'failed',
  ): void {
    recordBusinessOutcome({ operation: 'event.media_upload_intent', outcome });
  }
}
