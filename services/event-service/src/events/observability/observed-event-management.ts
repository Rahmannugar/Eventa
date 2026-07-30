import { recordBusinessOutcome } from '@eventa/observability';

import type { EventManagement, EventRecord } from '../types/event.types';

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

  private record(outcome: 'created' | 'failed'): void {
    recordBusinessOutcome({
      operation: 'event.draft_creation',
      outcome,
    });
  }
}
