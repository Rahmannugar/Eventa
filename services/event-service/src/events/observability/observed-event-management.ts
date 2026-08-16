import { recordBusinessOutcome } from '@eventa/observability';

import {
  EventNotFoundError,
  EventScheduleInvalidError,
  EventPublicationIncompleteError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  AdminEventListPage,
  CreateDraftEventCommand,
  EventManagement,
  EventRecord,
  UpdateDraftEventCommand,
  PublishEventCommand,
} from '../types/event.types';

export class ObservedEventManagement implements EventManagement {
  constructor(private readonly eventManagement: EventManagement) {}

  async createDraft(input: CreateDraftEventCommand): Promise<EventRecord> {
    try {
      const event = await this.eventManagement.createDraft(input);
      this.record('created');
      return event;
    } catch (error: unknown) {
      this.record('failed');
      throw error;
    }
  }

  list(pageSize: number, pageToken?: string): Promise<AdminEventListPage> {
    return this.eventManagement.list(pageSize, pageToken);
  }

  getById(eventId: string): Promise<EventRecord> {
    return this.eventManagement.getById(eventId);
  }

  getPublishedById(eventId: string): Promise<EventRecord> {
    return this.eventManagement.getPublishedById(eventId);
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

  async publish(input: PublishEventCommand): Promise<EventRecord> {
    try {
      const event = await this.eventManagement.publish(input);
      this.recordPublication('published');
      return event;
    } catch (error: unknown) {
      if (error instanceof EventVersionConflictError) {
        this.recordPublication('conflict');
      } else if (error instanceof EventNotFoundError) {
        this.recordPublication('not_found');
      } else if (error instanceof EventPublicationIncompleteError) {
        this.recordPublication('incomplete');
      } else {
        this.recordPublication('failed');
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

  private recordPublication(
    outcome: 'published' | 'conflict' | 'not_found' | 'incomplete' | 'failed',
  ): void {
    recordBusinessOutcome({ operation: 'event.publication', outcome });
  }
}
