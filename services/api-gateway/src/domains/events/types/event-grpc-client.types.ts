import type {
  CreateEventMediaUploadRequest,
  CreateEventMediaUploadResponse,
  AddEventTicketTypeRequest,
  AddEventTicketTypeResponse,
  DefineEventTicketCurrencyRequest,
  DefineEventTicketCurrencyResponse,
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
  GetEventTicketCatalogueRequest,
  GetEventTicketCatalogueResponse,
  RemoveEventMediaRequest,
  RemoveEventMediaResponse,
  PublishEventRequest,
  PublishEventResponse,
  RetireDraftEventRequest,
  RetireDraftEventResponse,
  RetireEventTicketTypeRequest,
  RetireEventTicketTypeResponse,
  UpdateDraftEventRequest,
  UpdateDraftEventResponse,
  UpdateEventTicketTypeRequest,
  UpdateEventTicketTypeResponse,
  GetEventWaitlistEntryRequest,
  GetEventWaitlistEntryResponse,
  JoinEventWaitlistRequest,
  JoinEventWaitlistResponse,
  LeaveEventWaitlistRequest,
  LeaveEventWaitlistResponse,
} from '@eventa/grpc-contracts';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export interface DeadlineAwareEventServiceClient {
  joinEventWaitlist(
    request: JoinEventWaitlistRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<JoinEventWaitlistResponse>;
  leaveEventWaitlist(
    request: LeaveEventWaitlistRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<LeaveEventWaitlistResponse>;
  getEventWaitlistEntry(
    request: GetEventWaitlistEntryRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetEventWaitlistEntryResponse>;
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
  defineEventTicketCurrency(
    request: DefineEventTicketCurrencyRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<DefineEventTicketCurrencyResponse>;
  addEventTicketType(
    request: AddEventTicketTypeRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<AddEventTicketTypeResponse>;
  updateEventTicketType(
    request: UpdateEventTicketTypeRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<UpdateEventTicketTypeResponse>;
  retireEventTicketType(
    request: RetireEventTicketTypeRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<RetireEventTicketTypeResponse>;
  getEventTicketCatalogue(
    request: GetEventTicketCatalogueRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetEventTicketCatalogueResponse>;
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
