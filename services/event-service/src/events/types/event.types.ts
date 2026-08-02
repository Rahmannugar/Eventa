export interface EventVenue {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
}

export interface EventRecord {
  eventId: string;
  title: string;
  description: string | null;
  category: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  timeZone: string | null;
  venue: EventVenue | null;
  status: 'draft';
  version: number;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDraftEvent {
  actorAdminId: string;
  requestId: string;
  title: string;
}

export interface UpdateDraftEvent {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  title: string;
  description: string;
  category: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  venue: EventVenue;
}

export type UpdateDraftEventResult =
  | { outcome: 'updated'; event: EventRecord }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict' };

export interface UpdateDraftEventCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  title: string;
  description: string;
  category: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venue: {
    name: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    countryCode: string;
  };
}

export interface EventRepository {
  createDraft(input: CreateDraftEvent): Promise<EventRecord>;
  findById(eventId: string): Promise<EventRecord | undefined>;
  updateDraft(input: UpdateDraftEvent): Promise<UpdateDraftEventResult>;
}

export interface EventManagement {
  createDraft(
    actorAdminId: string,
    title: string,
    requestId: string,
  ): Promise<EventRecord>;
  getById(eventId: string): Promise<EventRecord>;
  updateDraft(input: UpdateDraftEventCommand): Promise<EventRecord>;
}
