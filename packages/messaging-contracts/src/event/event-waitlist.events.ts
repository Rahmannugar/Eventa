export const EVENT_WAITLIST_ENTRY_ELIGIBLE_EVENT_TYPE =
  'event.waitlist-entry.eligible.v1' as const;

export interface EventWaitlistEntryEligibleEvent {
  type: typeof EVENT_WAITLIST_ENTRY_ELIGIBLE_EVENT_TYPE;
  waitlistEntryId: string;
  eventId: string;
  ticketTypeId: string;
  attendeeId: string;
  quantity: number;
  eligibleAt: string;
  opportunityExpiresAt: string;
}
