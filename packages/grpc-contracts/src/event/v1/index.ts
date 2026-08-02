export {
  EVENT_SERVICE_NAME,
  EVENTA_EVENT_V1_PACKAGE_NAME,
  EventServiceControllerMethods,
  type EventServiceClient,
  type EventServiceController,
} from '../../generated/eventa/event/v1/event_service.generated';
export {
  EventStatus,
  EventMediaSlot,
  EventMediaUploadStatus,
  type CreateEventMediaUploadRequest,
  type CreateEventMediaUploadResponse,
  type CreateDraftEventRequest,
  type CreateDraftEventResponse,
  type Event,
  type EventMedia,
  type GetAdminEventRequest,
  type GetAdminEventResponse,
  type GetEventMediaUploadRequest,
  type GetEventMediaUploadResponse,
  type UpdateDraftEventRequest,
  type UpdateDraftEventResponse,
  type Venue,
} from '../../generated/eventa/event/v1/event.generated';
export * from './proto-paths';
