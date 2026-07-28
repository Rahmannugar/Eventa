import { ATTENDEE_LIFECYCLE_TOPIC } from '@eventa/messaging-contracts/identity/attendee-lifecycle.events';

import type { KafkaClient } from '../../../infrastructure/clients/kafka.client';
import type { AttendeeLifecycleEventPublisher } from '../../ports/attendee-lifecycle-event.publisher';
import type { AttendeeDeletedEvent } from '@eventa/messaging-contracts/identity/attendee-lifecycle.events';

export class KafkaAttendeeLifecycleEventPublisher
  implements AttendeeLifecycleEventPublisher
{
  constructor(private readonly kafka: KafkaClient) {}

  publishDeleted(event: AttendeeDeletedEvent): Promise<void> {
    return this.kafka.publish(
      ATTENDEE_LIFECYCLE_TOPIC,
      event.attendeeId,
      JSON.stringify(event),
    );
  }
}
