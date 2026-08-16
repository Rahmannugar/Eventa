import {
  EventCategoriesInvalidError,
  EventNotFoundError,
  EventPageTokenInvalidError,
  EventPublicationIncompleteError,
  EventScheduleInvalidError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  AdminEventListPage,
  CreateDraftEventCommand,
  EventManagement,
  EventListCursor,
  EventRecord,
  EventRepository,
  PublishEventCommand,
  UpdateDraftEventCommand,
} from '../types/event.types';
import { EVENT_CATEGORY_LIMIT } from '../constants/event.constants';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EventManagementService implements EventManagement {
  constructor(private readonly events: EventRepository) {}

  async createDraft(input: CreateDraftEventCommand): Promise<EventRecord> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    this.assertSchedule(startsAt, endsAt);

    return this.events.createDraft({
      ...input,
      title: input.title.trim(),
      description: input.description.trim(),
      categories: this.normalizeCategories(input.categories),
      startsAt,
      endsAt,
      venue: this.normalizeVenue(input.venue),
    });
  }

  async list(
    pageSize: number,
    pageToken?: string,
  ): Promise<AdminEventListPage> {
    const cursor =
      pageToken === undefined ? undefined : this.decodePageToken(pageToken);
    const events = await this.events.list({
      limit: pageSize + 1,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const hasNextPage = events.length > pageSize;
    const page = hasNextPage ? events.slice(0, pageSize) : events;
    const lastEvent = page.at(-1);

    return {
      events: page,
      ...(hasNextPage && lastEvent !== undefined
        ? {
            nextPageToken: this.encodePageToken({
              eventId: lastEvent.eventId,
              updatedAt: lastEvent.updatedAt,
            }),
          }
        : {}),
    };
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

    this.assertSchedule(startsAt, endsAt);

    const result = await this.events.updateDraft({
      ...input,
      title: input.title.trim(),
      description: input.description.trim(),
      categories: this.normalizeCategories(input.categories),
      startsAt,
      endsAt,
      timeZone: input.timeZone,
      venue: this.normalizeVenue(input.venue),
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

  private assertSchedule(startsAt: Date, endsAt: Date): void {
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new EventScheduleInvalidError();
    }
  }

  private normalizeCategories(values: string[]): string[] {
    const categories: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const category = value.trim().replace(/\s+/g, ' ');
      const key = category.toLocaleLowerCase('en');
      if (category !== '' && !seen.has(key)) {
        categories.push(category);
        seen.add(key);
      }
    }

    if (categories.length === 0 || categories.length > EVENT_CATEGORY_LIMIT) {
      throw new EventCategoriesInvalidError();
    }

    return categories;
  }

  private normalizeVenue(input: CreateDraftEventCommand['venue']) {
    return {
      name: input.name.trim(),
      addressLine1: input.addressLine1.trim(),
      addressLine2: this.normalizeOptional(input.addressLine2),
      city: input.city.trim(),
      region: this.normalizeOptional(input.region),
      postalCode: this.normalizeOptional(input.postalCode),
      countryCode: input.countryCode.toUpperCase(),
    };
  }

  private encodePageToken(cursor: EventListCursor): string {
    return Buffer.from(
      JSON.stringify({
        eventId: cursor.eventId,
        updatedAt: cursor.updatedAt.toISOString(),
      }),
    ).toString('base64url');
  }

  private decodePageToken(value: string): EventListCursor {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      );
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('eventId' in parsed) ||
        typeof parsed.eventId !== 'string' ||
        !UUID_PATTERN.test(parsed.eventId) ||
        !('updatedAt' in parsed) ||
        typeof parsed.updatedAt !== 'string'
      ) {
        throw new EventPageTokenInvalidError();
      }

      const updatedAt = new Date(parsed.updatedAt);
      if (
        Number.isNaN(updatedAt.getTime()) ||
        updatedAt.toISOString() !== parsed.updatedAt
      ) {
        throw new EventPageTokenInvalidError();
      }

      return { eventId: parsed.eventId, updatedAt };
    } catch (error: unknown) {
      if (error instanceof EventPageTokenInvalidError) throw error;
      throw new EventPageTokenInvalidError();
    }
  }
}
