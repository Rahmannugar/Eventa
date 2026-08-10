import type {
  CreateEventMediaUploadRequest,
  CreateEventMediaUploadResponse,
  CreateDraftEventRequest,
  CreateDraftEventResponse,
  GetAdminEventRequest,
  GetAdminEventResponse,
  GetEventMediaUploadRequest,
  GetEventMediaUploadResponse,
  GetPublishedEventRequest,
  GetPublishedEventResponse,
  RemoveEventMediaRequest,
  RemoveEventMediaResponse,
  PublishEventRequest,
  PublishEventResponse,
  UpdateDraftEventRequest,
  UpdateDraftEventResponse,
} from '@eventa/grpc-contracts';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export interface DeadlineAwareEventServiceClient {
  createDraftEvent(
    request: CreateDraftEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<CreateDraftEventResponse>;
  getAdminEvent(
    request: GetAdminEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetAdminEventResponse>;
  getPublishedEvent(
    request: GetPublishedEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetPublishedEventResponse>;
  updateDraftEvent(
    request: UpdateDraftEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<UpdateDraftEventResponse>;
  createEventMediaUpload(
    request: CreateEventMediaUploadRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<CreateEventMediaUploadResponse>;
  getEventMediaUpload(
    request: GetEventMediaUploadRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetEventMediaUploadResponse>;
  removeEventMedia(
    request: RemoveEventMediaRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<RemoveEventMediaResponse>;
  publishEvent(
    request: PublishEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<PublishEventResponse>;
}
