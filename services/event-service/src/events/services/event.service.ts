import { EventNotFoundError } from '../errors/event.errors';
import type {
  EventManagement,
  EventRecord,
  EventRepository,
} from '../types/event.types';

export class EventApplicationService implements EventManagement {
  constructor(private readonly events: EventRepository) {}

  async createDraft(
    actorAdminId: string,
    title: string,
    requestId: string,
  ): Promise<EventRecord> {
    return this.events.createDraft({
      actorAdminId,
      requestId,
      title: title.trim(),
    });
  }

  async getById(eventId: string): Promise<EventRecord> {
    const event = await this.events.findById(eventId);

    if (event === undefined) {
      throw new EventNotFoundError();
    }

    return event;
  }
}
