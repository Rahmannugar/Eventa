export interface EventVenue {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  regionCode: string | null;
  postalCode: string | null;
  countryCode: string;
}

export interface EventRecord {
  eventId: string;
  title: string;
  description: string | null;
  categories: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  timeZone: string | null;
  venue: EventVenue | null;
  media: EventMediaRecord[];
  status: 'draft' | 'published';
  version: number;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  retiredAt: Date | null;
}

export type EventMediaSlot =
  'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';

export type EventMediaContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export type EventMediaUploadStatus =
  'pending' | 'attached' | 'rejected' | 'conflict' | 'expired';

export interface EventMediaRecord {
  mediaId: string;
  slot: EventMediaSlot;
  objectKey: string;
  contentType: EventMediaContentType;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface CreateEventMediaUploadCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  slot: EventMediaSlot;
  contentType: EventMediaContentType;
  sizeBytes: number;
  requestId: string;
}

export interface EventMediaUploadIntent {
  uploadId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
  verificationDeadlineAt: Date;
}

export interface EventMediaUploadRecord {
  uploadId: string;
  eventId: string;
  actorAdminId: string;
  requestId: string;
  slot: EventMediaSlot;
  objectKey: string;
  expectedEventVersion: number;
  declaredContentType: EventMediaContentType;
  declaredSizeBytes: number;
  status: EventMediaUploadStatus;
  failureCode: string | null;
  attachedEventVersion: number | null;
  expiresAt: Date;
  verificationDeadlineAt: Date;
  attemptCount: number;
  objectDeletionAttemptCount: number;
  claimToken: string | null;
  objectDeletedAt: Date | null;
  objectDeletionFailedAt: Date | null;
}

export interface EventMediaUploadStatusRecord {
  uploadId: string;
  slot: EventMediaSlot;
  status: EventMediaUploadStatus;
  expiresAt: Date;
  verificationDeadlineAt: Date;
  attachedEventVersion: number | null;
  failureCode: string | null;
}

export type CreateEventMediaUploadResult =
  | { outcome: 'created'; upload: EventMediaUploadRecord }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict' }
  | { outcome: 'upload_in_progress' };

export interface VerifiedEventMediaObject {
  contentType: EventMediaContentType;
  sizeBytes: number;
  width: number;
  height: number;
  etag: string;
}

export type EventMediaObjectInspection =
  | { outcome: 'missing' }
  | { outcome: 'invalid'; failureCode: string }
  | { outcome: 'verified'; object: VerifiedEventMediaObject };

export type AttachVerifiedEventMediaResult =
  | {
      outcome: 'attached';
      mutation: 'attached' | 'replaced';
      eventVersion: number;
    }
  | { outcome: 'already_terminal'; upload: EventMediaUploadRecord }
  | { outcome: 'conflict'; upload: EventMediaUploadRecord };

export type EventMediaVerificationOutcome =
  | { kind: 'attached' }
  | { kind: 'replaced' }
  | { kind: 'completed' }
  | { kind: 'retry'; retryAt: Date }
  | { kind: 'rejected' }
  | { kind: 'conflict' }
  | { kind: 'expired' }
  | { kind: 'object_deletion_failed' };

export interface EventMediaUploadRepository {
  createUpload(
    input: {
      uploadId: string;
      objectKey: string;
      expiresAt: Date;
      verificationDeadlineAt: Date;
    } & CreateEventMediaUploadCommand,
  ): Promise<CreateEventMediaUploadResult>;
  findStatus(
    eventId: string,
    uploadId: string,
  ): Promise<EventMediaUploadStatusRecord | undefined>;
  claimDispatchable(limit: number, leaseExpiresBefore: Date): Promise<string[]>;
  markDispatchFailed(uploadId: string): Promise<void>;
  claim(
    uploadId: string,
    claimToken: string,
    claimExpiresAt: Date,
  ): Promise<EventMediaUploadRecord | undefined>;
  scheduleRetry(
    uploadId: string,
    claimToken: string,
    nextAttemptAt: Date,
  ): Promise<void>;
  markTerminal(
    uploadId: string,
    claimToken: string,
    status: 'rejected' | 'expired',
    failureCode: string,
  ): Promise<EventMediaUploadRecord>;
  attachVerified(
    upload: EventMediaUploadRecord,
    verified: VerifiedEventMediaObject,
  ): Promise<AttachVerifiedEventMediaResult>;
  markObjectDeleted(uploadId: string, claimToken: string): Promise<void>;
  markObjectDeletionFailed(uploadId: string, claimToken: string): Promise<void>;
}

export interface EventMediaObjectStorage {
  createUploadUrl(input: {
    objectKey: string;
    contentType: EventMediaContentType;
    expiresInSeconds: number;
  }): Promise<{ url: string; requiredHeaders: Record<string, string> }>;
  inspect(input: EventMediaUploadRecord): Promise<EventMediaObjectInspection>;
  delete(objectKey: string): Promise<void>;
}

export interface EventMediaVerificationJobPublisher {
  publish(uploadId: string): Promise<void>;
}

export interface EventMediaManagement {
  createUpload(
    input: CreateEventMediaUploadCommand,
  ): Promise<EventMediaUploadIntent>;
  getUploadStatus(
    eventId: string,
    uploadId: string,
  ): Promise<EventMediaUploadStatusRecord>;
  remove(input: RemoveEventMediaCommand): Promise<number>;
}

export interface RemoveEventMediaCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  slot: EventMediaSlot;
}

export type RemoveEventMediaResult =
  | { outcome: 'removed'; eventVersion: number }
  | { outcome: 'not_found' }
  | { outcome: 'media_not_found' }
  | { outcome: 'version_conflict' };

export interface EventMediaMutationRepository {
  remove(input: RemoveEventMediaCommand): Promise<RemoveEventMediaResult>;
}

export interface EventMediaObjectDeletionRecord {
  deletionId: string;
  eventId: string;
  objectKey: string;
  reason: 'replaced' | 'removed';
  status: 'pending' | 'deleted' | 'failed';
  attemptCount: number;
  claimToken: string | null;
}

export interface EventMediaObjectDeletionRepository {
  claimDispatchable(limit: number, leaseExpiresBefore: Date): Promise<string[]>;
  markDispatchFailed(deletionId: string): Promise<void>;
  claim(
    deletionId: string,
    claimToken: string,
    claimExpiresAt: Date,
  ): Promise<EventMediaObjectDeletionRecord | undefined>;
  recordFailure(
    deletionId: string,
    claimToken: string,
    nextAttemptAt: Date,
  ): Promise<'retry' | 'failed'>;
  markDeleted(deletionId: string, claimToken: string): Promise<void>;
}

export interface EventMediaObjectDeletionJobPublisher {
  publish(deletionId: string): Promise<void>;
}

export interface CreateDraftEvent {
  actorAdminId: string;
  requestId: string;
  title: string;
  description: string;
  categories: string[];
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  venue: EventVenue;
}

export interface CreateDraftEventCommand {
  actorAdminId: string;
  requestId: string;
  title: string;
  description: string;
  categories: string[];
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venue: {
    name: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    region?: string;
    regionCode?: string;
    postalCode?: string;
    countryCode: string;
  };
}

export interface AdminEventSummaryRecord {
  eventId: string;
  title: string;
  categories: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  timeZone: string | null;
  venue: EventVenue | null;
  status: 'draft' | 'published';
  updatedAt: Date;
}

export type AdminEventSort =
  'updated_desc' | 'event_date_asc' | 'event_date_desc';

export interface EventListCursor {
  eventId: string;
  sortValue: Date | null;
  search: string | null;
  countryCode: string | null;
  regionCode: string | null;
  sort: AdminEventSort;
}

export interface ListAdminEvents {
  cursor?: EventListCursor;
  limit: number;
  search: string | null;
  countryCode: string | null;
  regionCode: string | null;
  sort: AdminEventSort;
}

export interface ListAdminEventsQuery {
  pageSize: number;
  pageToken?: string;
  search?: string;
  countryCode?: string;
  regionCode?: string;
  sort: AdminEventSort;
}

export interface AdminEventListPage {
  events: AdminEventSummaryRecord[];
  nextPageToken?: string;
}

export interface UpdateDraftEvent {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  title: string;
  description: string;
  categories: string[];
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  venue: EventVenue;
}

export type UpdateDraftEventResult =
  | { outcome: 'updated'; event: EventRecord }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict' };

export interface PublishEvent {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
}

export type PublishEventResult =
  | { outcome: 'published'; event: EventRecord }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict' }
  | { outcome: 'incomplete' };

export type PublishEventCommand = PublishEvent;

export interface RetireDraftEvent {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
}

export type RetireDraftEventResult =
  | { outcome: 'retired'; eventVersion: number }
  | { outcome: 'not_found' }
  | { outcome: 'not_draft' }
  | { outcome: 'version_conflict' };

export type RetireDraftEventCommand = RetireDraftEvent;

export type { EventPublishedEvent as EventPublishedFact } from '@eventa/messaging-contracts/event/event-lifecycle.events';

export interface UpdateDraftEventCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  title: string;
  description: string;
  categories: string[];
  startsAt: string;
  endsAt: string;
  timeZone: string;
  venue: {
    name: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    region?: string;
    regionCode?: string;
    postalCode?: string;
    countryCode: string;
  };
}

export interface EventRepository {
  createDraft(input: CreateDraftEvent): Promise<EventRecord>;
  list(input: ListAdminEvents): Promise<AdminEventSummaryRecord[]>;
  findById(eventId: string): Promise<EventRecord | undefined>;
  findPublishedById(eventId: string): Promise<EventRecord | undefined>;
  updateDraft(input: UpdateDraftEvent): Promise<UpdateDraftEventResult>;
  publish(input: PublishEvent): Promise<PublishEventResult>;
  retire(input: RetireDraftEvent): Promise<RetireDraftEventResult>;
}

export interface EventManagement {
  createDraft(input: CreateDraftEventCommand): Promise<EventRecord>;
  list(input: ListAdminEventsQuery): Promise<AdminEventListPage>;
  getById(eventId: string): Promise<EventRecord>;
  getPublishedById(eventId: string): Promise<EventRecord>;
  updateDraft(input: UpdateDraftEventCommand): Promise<EventRecord>;
  publish(input: PublishEventCommand): Promise<EventRecord>;
  retire(input: RetireDraftEventCommand): Promise<number>;
}

export interface EventTicketTypeRecord {
  ticketTypeId: string;
  eventId: string;
  ticketCurrencyId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  capacity: number;
  reservedQuantity: number;
  soldQuantity: number;
  salesStartAt: Date;
  salesEndAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventTicketCurrencyRecord {
  ticketCurrencyId: string;
  eventId: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventTicketTypesRecord {
  eventVersion: number;
  ticketCurrencies: EventTicketCurrencyRecord[];
  ticketTypes: EventTicketTypeRecord[];
}

export interface DefineEventTicketCurrencyCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  currency: string;
}

export interface DefineEventTicketCurrency {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  currency: string;
}

export type DefineEventTicketCurrencyResult =
  | {
      outcome: 'defined';
      eventVersion: number;
      ticketCurrency: EventTicketCurrencyRecord;
    }
  | { outcome: 'not_found' }
  | { outcome: 'not_draft' }
  | { outcome: 'version_conflict' }
  | { outcome: 'currency_conflict' };

export interface CreateEventTicketTypeCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  name: string;
  description?: string;
  ticketCurrencyId: string;
  priceMinor: number;
  capacity: number;
  salesStartAt: string;
  salesEndAt: string;
}

export interface CreateEventTicketType {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  name: string;
  description: string | null;
  ticketCurrencyId: string;
  priceMinor: number;
  capacity: number;
  salesStartAt: Date;
  salesEndAt: Date;
}

export type CreateEventTicketTypeResult =
  | {
      outcome: 'created';
      eventVersion: number;
      ticketType: EventTicketTypeRecord;
    }
  | { outcome: 'not_found' }
  | { outcome: 'not_draft' }
  | { outcome: 'version_conflict' }
  | { outcome: 'currency_not_found' }
  | { outcome: 'name_conflict' }
  | { outcome: 'invalid_window' }
  | { outcome: 'limit_reached' };

export interface UpdateEventTicketTypeCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  ticketTypeId: string;
  name: string;
  description?: string;
  priceMinor: number;
  capacity: number;
  salesStartAt: string;
  salesEndAt: string;
}

export interface UpdateEventTicketType {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  ticketTypeId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  capacity: number;
  salesStartAt: Date;
  salesEndAt: Date;
}

export type UpdateEventTicketTypeResult =
  | {
      outcome: 'updated';
      eventVersion: number;
      ticketType: EventTicketTypeRecord;
    }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict' }
  | { outcome: 'name_conflict' }
  | { outcome: 'invalid_window' }
  | { outcome: 'capacity_below_committed' }
  | { outcome: 'capacity_below_waitlist_demand' }
  | { outcome: 'commercial_terms_locked' };

export interface RetireEventTicketTypeCommand {
  actorAdminId: string;
  eventId: string;
  expectedVersion: number;
  requestId: string;
  ticketTypeId: string;
}

export type RetireEventTicketTypeResult =
  | { outcome: 'retired'; eventVersion: number }
  | { outcome: 'already_retired'; eventVersion: number }
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict' }
  | { outcome: 'committed_inventory' }
  | { outcome: 'last_published_type' };

export interface EventTicketTypeRepository {
  defineCurrency(
    input: DefineEventTicketCurrency,
  ): Promise<DefineEventTicketCurrencyResult>;
  create(input: CreateEventTicketType): Promise<CreateEventTicketTypeResult>;
  update(input: UpdateEventTicketType): Promise<UpdateEventTicketTypeResult>;
  retire(
    input: RetireEventTicketTypeCommand,
  ): Promise<RetireEventTicketTypeResult>;
  list(eventId: string): Promise<EventTicketTypesRecord | undefined>;
}

export interface EventTicketTypeManagement {
  defineCurrency(input: DefineEventTicketCurrencyCommand): Promise<{
    eventVersion: number;
    ticketCurrency: EventTicketCurrencyRecord;
  }>;
  create(input: CreateEventTicketTypeCommand): Promise<{
    eventVersion: number;
    ticketType: EventTicketTypeRecord;
  }>;
  update(input: UpdateEventTicketTypeCommand): Promise<{
    eventVersion: number;
    ticketType: EventTicketTypeRecord;
  }>;
  retire(input: RetireEventTicketTypeCommand): Promise<number>;
  list(eventId: string): Promise<EventTicketTypesRecord>;
}

export type EventCapacityReservationStatus =
  'active' | 'finalized' | 'released' | 'expired';

export interface EventCapacityReservationRecord {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  attendeeId: string | null;
  quantity: number;
  status: EventCapacityReservationStatus;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReserveEventCapacityCommand {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  attendeeId: string;
  requestId: string;
}

export interface TransitionEventCapacityReservationCommand {
  reservationId: string;
  eventId: string;
  ticketTypeId: string;
  requestId: string;
}

export type ReserveEventCapacityResult =
  | { outcome: 'reserved'; reservation: EventCapacityReservationRecord }
  | { outcome: 'existing'; reservation: EventCapacityReservationRecord }
  | { outcome: 'not_found' }
  | { outcome: 'sales_unavailable' }
  | { outcome: 'capacity_unavailable' }
  | { outcome: 'busy' }
  | { outcome: 'idempotency_conflict' }
  | { outcome: 'waitlist_priority' }
  | { outcome: 'waitlist_quantity_conflict' };

export type FinalizeEventCapacityReservationResult =
  | { outcome: 'finalized'; reservation: EventCapacityReservationRecord }
  | {
      outcome: 'already_finalized';
      reservation: EventCapacityReservationRecord;
    }
  | { outcome: 'expired'; reservation: EventCapacityReservationRecord }
  | { outcome: 'not_found' }
  | { outcome: 'identity_conflict' }
  | { outcome: 'busy' }
  | { outcome: 'terminal_conflict' };

export type ReleaseEventCapacityReservationResult =
  | { outcome: 'released'; reservation: EventCapacityReservationRecord }
  | { outcome: 'already_released'; reservation: EventCapacityReservationRecord }
  | { outcome: 'expired'; reservation: EventCapacityReservationRecord }
  | { outcome: 'not_found' }
  | { outcome: 'identity_conflict' }
  | { outcome: 'busy' }
  | { outcome: 'terminal_conflict' };

export interface EventCapacityReservationRepository {
  reserve(
    input: ReserveEventCapacityCommand,
  ): Promise<ReserveEventCapacityResult>;
  finalize(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<FinalizeEventCapacityReservationResult>;
  release(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<ReleaseEventCapacityReservationResult>;
  findDue(limit: number): Promise<string[]>;
  expire(reservationId: string): Promise<'expired' | 'unchanged' | 'not_found'>;
}

export interface EventCapacityReservationManagement {
  reserve(
    input: ReserveEventCapacityCommand,
  ): Promise<EventCapacityReservationRecord>;
  finalize(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<EventCapacityReservationRecord>;
  release(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<EventCapacityReservationRecord>;
}

export type EventWaitlistEntryStatus = 'waiting' | 'eligible';

export interface EventWaitlistEntryRecord {
  waitlistEntryId: string;
  eventId: string;
  ticketTypeId: string;
  attendeeId: string;
  quantity: number;
  status: EventWaitlistEntryStatus;
  position: number | null;
  eligibleAt: Date | null;
  opportunityExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventWaitlistCommand {
  eventId: string;
  ticketTypeId: string;
  attendeeId: string;
  requestId: string;
}

export interface JoinEventWaitlistCommand extends EventWaitlistCommand {
  quantity: number;
}

export type JoinEventWaitlistResult =
  | { outcome: 'joined' | 'existing'; entry: EventWaitlistEntryRecord }
  | { outcome: 'not_found' }
  | { outcome: 'sales_unavailable' }
  | { outcome: 'capacity_available' }
  | { outcome: 'quantity_exceeds_capacity' }
  | { outcome: 'quantity_conflict' }
  | { outcome: 'active_reservation' }
  | { outcome: 'full' }
  | { outcome: 'busy' };

export type LeaveEventWaitlistResult =
  | { outcome: 'left' }
  | { outcome: 'unchanged' }
  | { outcome: 'not_found' }
  | { outcome: 'busy' };

export interface EventWaitlistRepository {
  join(input: JoinEventWaitlistCommand): Promise<JoinEventWaitlistResult>;
  leave(input: EventWaitlistCommand): Promise<LeaveEventWaitlistResult>;
  find(
    input: Omit<EventWaitlistCommand, 'requestId'>,
  ): Promise<EventWaitlistEntryRecord | undefined>;
  findPromotionCandidates(
    afterTicketTypeId: string | null,
    limit: number,
  ): Promise<string[]>;
  promote(ticketTypeId: string, limit: number): Promise<number>;
}

export interface EventWaitlistManagement {
  join(input: JoinEventWaitlistCommand): Promise<EventWaitlistEntryRecord>;
  leave(input: EventWaitlistCommand): Promise<void>;
  get(
    input: Omit<EventWaitlistCommand, 'requestId'>,
  ): Promise<EventWaitlistEntryRecord>;
}

export type AttendeeTicketAvailabilityStatus =
  'available' | 'waiting' | 'eligible' | 'reserved' | 'unavailable';

export interface AttendeeEventTicketTypeRecord {
  ticketTypeId: string;
  eventId: string;
  ticketCurrencyId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  salesStartAt: Date;
  salesEndAt: Date;
  salesOpen: boolean;
  availabilityStatus: AttendeeTicketAvailabilityStatus;
  availableQuantity: number;
  canJoinWaitlist: boolean;
  waitlistPosition: number | null;
  opportunityExpiresAt: Date | null;
  reservationExpiresAt: Date | null;
}

export interface AttendeeEventTicketCatalogueRecord {
  eventId: string;
  ticketCurrencies: EventTicketCurrencyRecord[];
  ticketTypes: AttendeeEventTicketTypeRecord[];
}

export interface EventTicketAvailabilityRepository {
  getCatalogue(
    eventId: string,
    attendeeId: string,
  ): Promise<AttendeeEventTicketCatalogueRecord | undefined>;
}

export interface EventTicketAvailabilityManagement {
  getCatalogue(
    eventId: string,
    attendeeId: string,
  ): Promise<AttendeeEventTicketCatalogueRecord>;
}
