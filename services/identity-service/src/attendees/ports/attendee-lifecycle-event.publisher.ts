import type { AttendeeDeletedEvent } from '@eventa/messaging-contracts/identity/attendee-lifecycle.events';

export interface AttendeeLifecycleEventPublisher {
  publishDeleted(event: AttendeeDeletedEvent): Promise<void>;
}
