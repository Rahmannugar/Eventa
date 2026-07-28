export const ATTENDEE_LIFECYCLE_TOPIC =
  'eventa.identity.attendee-lifecycle.v1';

export const ATTENDEE_DELETED_EVENT_TYPE = 'attendee.deleted.v1';

export interface AttendeeDeletedEvent {
  attendeeId: string;
  deletedAt: string;
  eventId: string;
  type: typeof ATTENDEE_DELETED_EVENT_TYPE;
}
