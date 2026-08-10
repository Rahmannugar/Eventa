import {
  EventNotFoundError,
  EventPublicationIncompleteError,
  EventScheduleInvalidError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  EventManagement,
  EventRecord,
  EventRepository,
  PublishEventCommand,
  UpdateDraftEventCommand,
} from '../types/event.types';

export class EventManagementService implements EventManagement {
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

  async getPublishedById(eventId: string): Promise<EventRecord> {
    const event = await this.events.findPublishedById(eventId);

    if (event === undefined) {
      throw new EventNotFoundError();
    }

    return event;
  }

  async updateDraft(input: UpdateDraftEventCommand): Promise<EventRecord> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new EventScheduleInvalidError();
    }

    const result = await this.events.updateDraft({
      ...input,
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category.trim(),
      startsAt,
      endsAt,
      timeZone: input.timeZone,
      venue: {
        name: input.venue.name.trim(),
        addressLine1: input.venue.addressLine1.trim(),
        addressLine2: this.normalizeOptional(input.venue.addressLine2),
        city: input.venue.city.trim(),
        region: this.normalizeOptional(input.venue.region),
        postalCode: this.normalizeOptional(input.venue.postalCode),
        countryCode: input.venue.countryCode.toUpperCase(),
      },
    });

    if (result.outcome === 'not_found') {
      throw new EventNotFoundError();
    }

    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }

    return result.event;
  }

  async publish(input: PublishEventCommand): Promise<EventRecord> {
    const result = await this.events.publish(input);

    if (result.outcome === 'not_found') {
      throw new EventNotFoundError();
    }
    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }
    if (result.outcome === 'incomplete') {
      throw new EventPublicationIncompleteError();
    }

    return result.event;
  }

  private normalizeOptional(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized === undefined || normalized === '' ? null : normalized;
  }
}
