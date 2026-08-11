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
  media: EventMediaRecord[];
  status: 'draft' | 'published';
  version: number;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
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

export type { EventPublishedEvent as EventPublishedFact } from '@eventa/messaging-contracts/event/event-lifecycle.events';

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
  findPublishedById(eventId: string): Promise<EventRecord | undefined>;
  updateDraft(input: UpdateDraftEvent): Promise<UpdateDraftEventResult>;
  publish(input: PublishEvent): Promise<PublishEventResult>;
}

export interface EventManagement {
  createDraft(
    actorAdminId: string,
    title: string,
    requestId: string,
  ): Promise<EventRecord>;
  getById(eventId: string): Promise<EventRecord>;
  getPublishedById(eventId: string): Promise<EventRecord>;
  updateDraft(input: UpdateDraftEventCommand): Promise<EventRecord>;
  publish(input: PublishEventCommand): Promise<EventRecord>;
}
