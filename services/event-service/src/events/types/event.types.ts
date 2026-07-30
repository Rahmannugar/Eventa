export interface EventRecord {
  eventId: string;
  title: string;
  status: 'draft';
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDraftEvent {
  actorAdminId: string;
  requestId: string;
  title: string;
}

export interface EventRepository {
  createDraft(input: CreateDraftEvent): Promise<EventRecord>;
  findById(eventId: string): Promise<EventRecord | undefined>;
}

export interface EventManagement {
  createDraft(
    actorAdminId: string,
    title: string,
    requestId: string,
  ): Promise<EventRecord>;
  getById(eventId: string): Promise<EventRecord>;
}
