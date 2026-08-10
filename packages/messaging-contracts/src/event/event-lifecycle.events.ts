export const EVENT_LIFECYCLE_TOPIC = 'eventa.event.lifecycle.v1';

export const EVENT_PUBLISHED_EVENT_TYPE = 'event.published.v1';

export interface EventPublishedEvent {
  eventId: string;
  publishedAt: string;
  type: typeof EVENT_PUBLISHED_EVENT_TYPE;
  version: number;
}
