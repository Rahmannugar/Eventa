import { recordBusinessOutcome } from '@eventa/observability';

import {
  EventNotFoundError,
  EventScheduleInvalidError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  EventManagement,
  EventRecord,
  UpdateDraftEventCommand,
} from '../types/event.types';

export class ObservedEventManagement implements EventManagement {
  constructor(private readonly eventManagement: EventManagement) {}

  async createDraft(
    actorAdminId: string,
    title: string,
    requestId: string,
  ): Promise<EventRecord> {
    try {
      const event = await this.eventManagement.createDraft(
        actorAdminId,
        title,
        requestId,
      );
      this.record('created');
      return event;
    } catch (error: unknown) {
      this.record('failed');
      throw error;
    }
  }

  getById(eventId: string): Promise<EventRecord> {
    return this.eventManagement.getById(eventId);
  }

  async updateDraft(input: UpdateDraftEventCommand): Promise<EventRecord> {
    try {
      const event = await this.eventManagement.updateDraft(input);
      this.recordUpdate('updated');
      return event;
    } catch (error: unknown) {
      if (error instanceof EventVersionConflictError) {
        this.recordUpdate('conflict');
      } else if (error instanceof EventNotFoundError) {
        this.recordUpdate('not_found');
      } else if (error instanceof EventScheduleInvalidError) {
        this.recordUpdate('invalid_schedule');
      } else {
        this.recordUpdate('failed');
      }
      throw error;
    }
  }

  private record(outcome: 'created' | 'failed'): void {
    recordBusinessOutcome({
      operation: 'event.draft_creation',
      outcome,
    });
  }

  private recordUpdate(
    outcome:
      'updated' | 'conflict' | 'not_found' | 'invalid_schedule' | 'failed',
  ): void {
    recordBusinessOutcome({
      operation: 'event.draft_update',
      outcome,
    });
  }
}
