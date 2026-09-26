export interface EventSummary {
  eventId: string;
  startsAt?: string;
  timeZone?: string;
  title: string;
  venueCity?: string;
  venueName?: string;
}

export interface EventSummaryProvider {
  getSummary(eventId: string): Promise<EventSummary>;
}
