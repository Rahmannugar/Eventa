import type {
  CreateEventMediaUploadRequest,
  CreateEventMediaUploadResponse,
  CreateEventTicketTypeRequest,
  CreateEventTicketTypeResponse,
  CreateDraftEventRequest,
  CreateDraftEventResponse,
  GetAdminEventRequest,
  GetAdminEventResponse,
  GetEventMediaUploadRequest,
  GetEventMediaUploadResponse,
  GetPublishedEventRequest,
  GetPublishedEventResponse,
  ListAdminEventsRequest,
  ListAdminEventsResponse,
  ListEventTicketTypesRequest,
  ListEventTicketTypesResponse,
  RemoveEventMediaRequest,
  RemoveEventMediaResponse,
  PublishEventRequest,
  PublishEventResponse,
  RetireDraftEventRequest,
  RetireDraftEventResponse,
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
  listAdminEvents(
    request: ListAdminEventsRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<ListAdminEventsResponse>;
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
  createEventTicketType(
    request: CreateEventTicketTypeRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<CreateEventTicketTypeResponse>;
  listEventTicketTypes(
    request: ListEventTicketTypesRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<ListEventTicketTypesResponse>;
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
  retireDraftEvent(
    request: RetireDraftEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<RetireDraftEventResponse>;
}
