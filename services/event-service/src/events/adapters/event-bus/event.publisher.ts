import {
  EVENT_LIFECYCLE_TOPIC,
  type EventPublishedEvent,
} from '@eventa/messaging-contracts/event/event-lifecycle.events';

import type { KafkaClient } from '../../../infrastructure/clients/kafka.client';
import type { EventPublisher } from '../../types/event.types';

export class KafkaEventPublisher implements EventPublisher {
  constructor(private readonly kafka: KafkaClient) {}

  publish(event: EventPublishedEvent): Promise<void> {
    return this.kafka.publish(
      EVENT_LIFECYCLE_TOPIC,
      event.eventId,
      JSON.stringify(event),
    );
  }
}
