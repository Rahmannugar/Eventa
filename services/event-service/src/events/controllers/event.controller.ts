import { randomUUID } from 'node:crypto';

import {
  AdminEventSort,
  type AddEventTicketTypeResponse,
  EventMediaSlot,
  EventMediaUploadStatus,
  EventServiceControllerMethods,
  EventStatus,
  type CreateDraftEventResponse,
  type CreateEventMediaUploadResponse,
  type CreateEventTicketTypeResponse,
  type DefineEventTicketCurrencyResponse,
  type Event,
  type EventTicketCurrency,
  type EventTicketType,
  type EventServiceController,
  type GetAdminEventResponse,
  type GetEventMediaUploadResponse,
  type GetEventTicketCatalogueResponse,
  type ListAdminEventsResponse,
  type ListEventTicketTypesResponse,
  type GetPublishedEventResponse,
  type PublishedEvent,
  type RemoveEventMediaResponse,
  type PublishEventResponse,
  type RetireDraftEventResponse,
  type RetireEventTicketTypeResponse,
  type UpdateEventTicketTypeResponse,
  type UpdateDraftEventResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import { Controller, Inject } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { from, type Observable } from 'rxjs';

import type { RuntimeConfig } from '../../config/runtime-config';
import { RUNTIME_CONFIG } from '../../config/runtime.constants';
import {
  EVENT_MANAGEMENT,
  EVENT_MEDIA_MANAGEMENT,
  EVENT_TICKET_TYPE_MANAGEMENT,
} from '../constants/event.constants';
import {
  GetAdminEventDto,
  CreateDraftEventDto,
  ListAdminEventsDto,
  PublishEventDto,
  RetireDraftEventDto,
  UpdateDraftEventDto,
} from '../dto/event-management.dto';
import {
  CreateEventMediaUploadDto,
  GetEventMediaUploadDto,
  RemoveEventMediaDto,
} from '../dto/event-media.dto';
import { GetPublishedEventDto } from '../dto/published-event.dto';
import {
  AddEventTicketTypeDto,
  DefineEventTicketCurrencyDto,
  GetEventTicketCatalogueDto,
  RetireEventTicketTypeDto,
  UpdateEventTicketTypeDto,
} from '../dto/event-ticket-type.dto';
import {
  EventCategoriesInvalidError,
  EventMediaNotFoundError,
  EventMediaUploadInProgressError,
  EventMediaUploadNotFoundError,
  EventNotFoundError,
  EventPageTokenInvalidError,
  EventPublicationIncompleteError,
  EventRetirementNotAllowedError,
  EventScheduleInvalidError,
  EventVersionConflictError,
  EventVenueInvalidError,
  EventTicketCurrencyConflictError,
  EventTicketCurrencyNotFoundError,
  EventTicketTypeInvalidError,
  EventTicketTypeLimitReachedError,
  EventTicketTypeMutationNotAllowedError,
  EventTicketTypeNameConflictError,
  EventTicketTypeNotFoundError,
  EventTicketTypeCapacityBelowCommittedError,
  EventTicketTypeCommercialTermsLockedError,
  EventTicketTypeRetirementNotAllowedError,
} from '../errors/event.errors';
import type {
  EventManagement,
  AdminEventSort as DomainAdminEventSort,
  EventMediaManagement,
  EventMediaSlot as DomainEventMediaSlot,
  EventMediaUploadStatus as DomainEventMediaUploadStatus,
  EventRecord,
  EventTicketTypeManagement,
  EventTicketTypeRecord,
  EventTicketCurrencyRecord,
} from '../types/event.types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

@Controller()
@EventServiceControllerMethods()
export class EventController implements EventServiceController {
  constructor(
    @Inject(EVENT_MANAGEMENT)
    private readonly eventService: EventManagement,
    @Inject(EVENT_MEDIA_MANAGEMENT)
    private readonly mediaService: EventMediaManagement,
    @Inject(EVENT_TICKET_TYPE_MANAGEMENT)
    private readonly ticketTypeService: EventTicketTypeManagement,
    @Inject(RUNTIME_CONFIG)
    private readonly config: RuntimeConfig,
  ) {}

  createDraftEvent(
    request: CreateDraftEventDto,
    metadata?: Metadata,
  ): Observable<CreateDraftEventResponse> {
    return from(this.createEvent(request, this.readRequestId(metadata)));
  }

  listAdminEvents(
    request: ListAdminEventsDto,
  ): Observable<ListAdminEventsResponse> {
    return from(this.listEvents(request));
  }

  getAdminEvent(request: GetAdminEventDto): Observable<GetAdminEventResponse> {
    return from(this.getEvent(request.eventId));
  }

  getPublishedEvent(
    request: GetPublishedEventDto,
  ): Observable<GetPublishedEventResponse> {
    return from(this.getPublished(request.eventId));
  }

  updateDraftEvent(
    request: UpdateDraftEventDto,
    metadata?: Metadata,
  ): Observable<UpdateDraftEventResponse> {
    return from(this.updateEvent(request, this.readRequestId(metadata)));
  }

  defineEventTicketCurrency(
    request: DefineEventTicketCurrencyDto,
    metadata?: Metadata,
  ): Observable<DefineEventTicketCurrencyResponse> {
    return from(
      this.defineTicketCurrency(request, this.readRequestId(metadata)),
    );
  }

  createEventTicketType(): Observable<CreateEventTicketTypeResponse> {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'EVENT_TICKET_CATALOGUE_CONTRACT_REPLACED',
    });
  }

  listEventTicketTypes(): Observable<ListEventTicketTypesResponse> {
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'EVENT_TICKET_CATALOGUE_CONTRACT_REPLACED',
    });
  }

  addEventTicketType(
    request: AddEventTicketTypeDto,
    metadata?: Metadata,
  ): Observable<AddEventTicketTypeResponse> {
    return from(this.createTicketType(request, this.readRequestId(metadata)));
  }

  updateEventTicketType(
    request: UpdateEventTicketTypeDto,
    metadata?: Metadata,
  ): Observable<UpdateEventTicketTypeResponse> {
    return from(this.updateTicketType(request, this.readRequestId(metadata)));
  }

  retireEventTicketType(
    request: RetireEventTicketTypeDto,
    metadata?: Metadata,
  ): Observable<RetireEventTicketTypeResponse> {
    return from(this.retireTicketType(request, this.readRequestId(metadata)));
  }

  getEventTicketCatalogue(
    request: GetEventTicketCatalogueDto,
  ): Observable<GetEventTicketCatalogueResponse> {
    return from(this.listTicketTypes(request.eventId));
  }

  createEventMediaUpload(
    request: CreateEventMediaUploadDto,
    metadata?: Metadata,
  ): Observable<CreateEventMediaUploadResponse> {
    return from(this.createMediaUpload(request, this.readRequestId(metadata)));
  }

  getEventMediaUpload(
    request: GetEventMediaUploadDto,
  ): Observable<GetEventMediaUploadResponse> {
    return from(this.getMediaUpload(request));
  }

  removeEventMedia(
    request: RemoveEventMediaDto,
    metadata?: Metadata,
  ): Observable<RemoveEventMediaResponse> {
    return from(this.removeMedia(request, this.readRequestId(metadata)));
  }

  publishEvent(
    request: PublishEventDto,
    metadata?: Metadata,
  ): Observable<PublishEventResponse> {
    return from(this.publish(request, this.readRequestId(metadata)));
  }

  retireDraftEvent(
    request: RetireDraftEventDto,
    metadata?: Metadata,
  ): Observable<RetireDraftEventResponse> {
    return from(this.retire(request, this.readRequestId(metadata)));
  }

  private async getEvent(eventId: string): Promise<GetAdminEventResponse> {
    try {
      return {
        event: this.toContract(await this.eventService.getById(eventId)),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async retire(
    request: RetireDraftEventDto,
    requestId: string,
  ): Promise<RetireDraftEventResponse> {
    try {
      return {
        eventVersion: await this.eventService.retire({
          actorAdminId: request.adminId,
          eventId: request.eventId,
          expectedVersion: request.expectedVersion,
          requestId,
        }),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (error instanceof EventRetirementNotAllowedError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async createEvent(
    request: CreateDraftEventDto,
    requestId: string,
  ): Promise<CreateDraftEventResponse> {
    try {
      return {
        event: this.toContract(
          await this.eventService.createDraft({
            actorAdminId: request.adminId,
            categories: request.categories,
            description: request.description,
            endsAt: request.endsAt,
            requestId,
            startsAt: request.startsAt,
            timeZone: request.timeZone,
            title: request.title,
            venue: {
              ...request.venue!,
              addressLine1: request.venue!.addressLineOne,
              ...(request.venue!.addressLineTwo === undefined
                ? {}
                : { addressLine2: request.venue!.addressLineTwo }),
            },
          }),
        ),
      };
    } catch (error: unknown) {
      if (
        error instanceof EventCategoriesInvalidError ||
        error instanceof EventScheduleInvalidError ||
        error instanceof EventVenueInvalidError
      ) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async listEvents(
    request: ListAdminEventsDto,
  ): Promise<ListAdminEventsResponse> {
    try {
      if (
        request.regionCode !== undefined &&
        request.countryCode === undefined
      ) {
        throw new EventPageTokenInvalidError();
      }
      const page = await this.eventService.list({
        pageSize: request.pageSize,
        ...(request.pageToken === undefined
          ? {}
          : { pageToken: request.pageToken }),
        ...(request.search === undefined ? {} : { search: request.search }),
        ...(request.countryCode === undefined
          ? {}
          : { countryCode: request.countryCode }),
        ...(request.regionCode === undefined
          ? {}
          : { regionCode: request.regionCode }),
        sort: this.toDomainSort(request.sort),
      });
      return {
        events: page.events.map((event) => ({
          eventId: event.eventId,
          title: event.title,
          categories: event.categories,
          status:
            event.status === 'published'
              ? EventStatus.EVENT_STATUS_PUBLISHED
              : EventStatus.EVENT_STATUS_DRAFT,
          startsAt: event.startsAt?.toISOString(),
          endsAt: event.endsAt?.toISOString(),
          timeZone: event.timeZone ?? undefined,
          venue:
            event.venue === null
              ? undefined
              : {
                  name: event.venue.name,
                  addressLine1: event.venue.addressLine1,
                  addressLine2: event.venue.addressLine2 ?? undefined,
                  addressLineOne: event.venue.addressLine1,
                  addressLineTwo: event.venue.addressLine2 ?? undefined,
                  city: event.venue.city,
                  region: event.venue.region ?? undefined,
                  regionCode: event.venue.regionCode ?? undefined,
                  postalCode: event.venue.postalCode ?? undefined,
                  countryCode: event.venue.countryCode,
                },
          updatedAt: event.updatedAt.toISOString(),
        })),
        nextPageToken: page.nextPageToken,
      };
    } catch (error: unknown) {
      if (error instanceof EventPageTokenInvalidError) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async getPublished(
    eventId: string,
  ): Promise<GetPublishedEventResponse> {
    try {
      return {
        event: this.toPublishedContract(
          await this.eventService.getPublishedById(eventId),
        ),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async updateEvent(
    request: UpdateDraftEventDto,
    requestId: string,
  ): Promise<UpdateDraftEventResponse> {
    try {
      return {
        event: this.toContract(
          await this.eventService.updateDraft({
            actorAdminId: request.adminId,
            categories:
              request.categories.length === 0 && request.category !== ''
                ? [request.category]
                : request.categories,
            description: request.description,
            endsAt: request.endsAt,
            eventId: request.eventId,
            expectedVersion: request.expectedVersion,
            requestId,
            startsAt: request.startsAt,
            timeZone: request.timeZone,
            title: request.title,
            venue: {
              ...request.venue!,
              addressLine1: request.venue!.addressLineOne,
              ...(request.venue!.addressLineTwo === undefined
                ? {}
                : { addressLine2: request.venue!.addressLineTwo }),
            },
          }),
        ),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (
        error instanceof EventCategoriesInvalidError ||
        error instanceof EventScheduleInvalidError ||
        error instanceof EventVenueInvalidError
      ) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async createMediaUpload(
    request: CreateEventMediaUploadDto,
    requestId: string,
  ): Promise<CreateEventMediaUploadResponse> {
    try {
      const upload = await this.mediaService.createUpload({
        actorAdminId: request.adminId,
        eventId: request.eventId,
        expectedVersion: request.expectedVersion,
        slot: this.toDomainSlot(request.slot),
        contentType: request.contentType,
        sizeBytes: request.sizeBytes,
        requestId,
      });
      return {
        uploadId: upload.uploadId,
        uploadUrl: upload.uploadUrl,
        requiredHeaders: upload.requiredHeaders,
        expiresAt: upload.expiresAt.toISOString(),
        verificationDeadlineAt: upload.verificationDeadlineAt.toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (error instanceof EventMediaUploadInProgressError) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async getMediaUpload(
    request: GetEventMediaUploadDto,
  ): Promise<GetEventMediaUploadResponse> {
    try {
      const upload = await this.mediaService.getUploadStatus(
        request.eventId,
        request.uploadId,
      );
      return {
        uploadId: upload.uploadId,
        status: this.toContractUploadStatus(upload.status),
        slot: this.toContractSlot(upload.slot),
        expiresAt: upload.expiresAt.toISOString(),
        verificationDeadlineAt: upload.verificationDeadlineAt.toISOString(),
        attachedEventVersion: upload.attachedEventVersion ?? undefined,
        failureCode: upload.failureCode ?? undefined,
      };
    } catch (error: unknown) {
      if (error instanceof EventMediaUploadNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async removeMedia(
    request: RemoveEventMediaDto,
    requestId: string,
  ): Promise<RemoveEventMediaResponse> {
    try {
      return {
        eventVersion: await this.mediaService.remove({
          actorAdminId: request.adminId,
          eventId: request.eventId,
          expectedVersion: request.expectedVersion,
          requestId,
          slot: this.toDomainSlot(request.slot),
        }),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (error instanceof EventMediaNotFoundError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async publish(
    request: PublishEventDto,
    requestId: string,
  ): Promise<PublishEventResponse> {
    try {
      return {
        event: this.toContract(
          await this.eventService.publish({
            actorAdminId: request.adminId,
            eventId: request.eventId,
            expectedVersion: request.expectedVersion,
            requestId,
          }),
        ),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (error instanceof EventPublicationIncompleteError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async createTicketType(
    request: AddEventTicketTypeDto,
    requestId: string,
  ): Promise<AddEventTicketTypeResponse> {
    try {
      const result = await this.ticketTypeService.create({
        actorAdminId: request.adminId,
        capacity: request.capacity,
        ...(request.description === undefined
          ? {}
          : { description: request.description }),
        eventId: request.eventId,
        expectedVersion: request.expectedVersion,
        name: request.name,
        priceMinor: request.priceMinor,
        requestId,
        salesEndAt: request.salesEndAt,
        salesStartAt: request.salesStartAt,
        ticketCurrencyId: request.ticketCurrencyId,
      });
      return {
        eventVersion: result.eventVersion,
        ticketType: this.toTicketTypeContract(result.ticketType),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (
        error instanceof EventTicketTypeInvalidError ||
        error instanceof EventTicketCurrencyNotFoundError ||
        error instanceof EventTicketTypeNameConflictError
      ) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      if (
        error instanceof EventTicketTypeLimitReachedError ||
        error instanceof EventTicketTypeMutationNotAllowedError
      ) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async updateTicketType(
    request: UpdateEventTicketTypeDto,
    requestId: string,
  ): Promise<UpdateEventTicketTypeResponse> {
    try {
      const result = await this.ticketTypeService.update({
        actorAdminId: request.adminId,
        capacity: request.capacity,
        ...(request.description === undefined
          ? {}
          : { description: request.description }),
        eventId: request.eventId,
        expectedVersion: request.expectedVersion,
        name: request.name,
        priceMinor: request.priceMinor,
        requestId,
        salesEndAt: request.salesEndAt,
        salesStartAt: request.salesStartAt,
        ticketTypeId: request.ticketTypeId,
      });
      return {
        eventVersion: result.eventVersion,
        ticketType: this.toTicketTypeContract(result.ticketType),
      };
    } catch (error: unknown) {
      if (error instanceof EventTicketTypeNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (
        error instanceof EventTicketTypeInvalidError ||
        error instanceof EventTicketTypeNameConflictError
      ) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      if (
        error instanceof EventTicketTypeCapacityBelowCommittedError ||
        error instanceof EventTicketTypeCommercialTermsLockedError
      ) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async retireTicketType(
    request: RetireEventTicketTypeDto,
    requestId: string,
  ): Promise<RetireEventTicketTypeResponse> {
    try {
      return {
        eventVersion: await this.ticketTypeService.retire({
          actorAdminId: request.adminId,
          eventId: request.eventId,
          expectedVersion: request.expectedVersion,
          requestId,
          ticketTypeId: request.ticketTypeId,
        }),
      };
    } catch (error: unknown) {
      if (error instanceof EventTicketTypeNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (error instanceof EventTicketTypeInvalidError) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      if (error instanceof EventTicketTypeRetirementNotAllowedError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async defineTicketCurrency(
    request: DefineEventTicketCurrencyDto,
    requestId: string,
  ): Promise<DefineEventTicketCurrencyResponse> {
    try {
      const result = await this.ticketTypeService.defineCurrency({
        actorAdminId: request.adminId,
        currency: request.currency,
        eventId: request.eventId,
        expectedVersion: request.expectedVersion,
        requestId,
      });
      return {
        eventVersion: result.eventVersion,
        ticketCurrency: this.toTicketCurrencyContract(result.ticketCurrency),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      if (error instanceof EventVersionConflictError) {
        throw new RpcException({
          code: status.ABORTED,
          message: error.message,
        });
      }
      if (
        error instanceof EventTicketTypeInvalidError ||
        error instanceof EventTicketCurrencyConflictError
      ) {
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: error.message,
        });
      }
      if (error instanceof EventTicketTypeMutationNotAllowedError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async listTicketTypes(
    eventId: string,
  ): Promise<GetEventTicketCatalogueResponse> {
    try {
      const result = await this.ticketTypeService.list(eventId);
      return {
        eventVersion: result.eventVersion,
        ticketCurrencies: result.ticketCurrencies.map((ticketCurrency) =>
          this.toTicketCurrencyContract(ticketCurrency),
        ),
        ticketTypes: result.ticketTypes.map((ticketType) =>
          this.toTicketTypeContract(ticketType),
        ),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private toTicketTypeContract(
    ticketType: EventTicketTypeRecord,
  ): EventTicketType {
    return {
      allocation: ticketType.capacity,
      capacity: ticketType.capacity,
      reservedQuantity: ticketType.reservedQuantity,
      soldQuantity: ticketType.soldQuantity,
      availableQuantity:
        ticketType.capacity -
        ticketType.reservedQuantity -
        ticketType.soldQuantity,
      createdAt: ticketType.createdAt.toISOString(),
      description: ticketType.description ?? undefined,
      eventId: ticketType.eventId,
      name: ticketType.name,
      priceMinor: ticketType.priceMinor,
      salesEndAt: ticketType.salesEndAt.toISOString(),
      salesStartAt: ticketType.salesStartAt.toISOString(),
      ticketTypeId: ticketType.ticketTypeId,
      ticketCurrencyId: ticketType.ticketCurrencyId,
      updatedAt: ticketType.updatedAt.toISOString(),
    };
  }

  private toTicketCurrencyContract(
    ticketCurrency: EventTicketCurrencyRecord,
  ): EventTicketCurrency {
    return {
      createdAt: ticketCurrency.createdAt.toISOString(),
      currency: ticketCurrency.currency,
      eventId: ticketCurrency.eventId,
      ticketCurrencyId: ticketCurrency.ticketCurrencyId,
      updatedAt: ticketCurrency.updatedAt.toISOString(),
    };
  }

  private readRequestId(metadata?: Metadata): string {
    const value = metadata?.get('x-request-id')[0];
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
      ? value
      : randomUUID();
  }

  private toContract(event: EventRecord): Event {
    return {
      eventId: event.eventId,
      title: event.title,
      description: event.description ?? undefined,
      category: event.categories[0],
      categories: event.categories,
      startsAt: event.startsAt?.toISOString(),
      endsAt: event.endsAt?.toISOString(),
      timeZone: event.timeZone ?? undefined,
      venue:
        event.venue === null
          ? undefined
          : {
              name: event.venue.name,
              addressLine1: event.venue.addressLine1,
              addressLine2: event.venue.addressLine2 ?? undefined,
              addressLineOne: event.venue.addressLine1,
              addressLineTwo: event.venue.addressLine2 ?? undefined,
              city: event.venue.city,
              region: event.venue.region ?? undefined,
              regionCode: event.venue.regionCode ?? undefined,
              postalCode: event.venue.postalCode ?? undefined,
              countryCode: event.venue.countryCode,
            },
      media: event.media.map((media) => ({
        mediaId: media.mediaId,
        slot: this.toContractSlot(media.slot),
        url: `${this.config.cloudflareR2PublicBaseUrl}/${media.objectKey}`,
        contentType: media.contentType,
        sizeBytes: media.sizeBytes,
        width: media.width,
        height: media.height,
      })),
      status:
        event.status === 'published'
          ? EventStatus.EVENT_STATUS_PUBLISHED
          : EventStatus.EVENT_STATUS_DRAFT,
      version: event.version,
      createdByAdminId: event.createdByAdminId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      publishedAt: event.publishedAt?.toISOString(),
    };
  }

  private toPublishedContract(event: EventRecord): PublishedEvent {
    if (
      event.status !== 'published' ||
      event.description === null ||
      event.categories.length === 0 ||
      event.startsAt === null ||
      event.endsAt === null ||
      event.timeZone === null ||
      event.venue === null ||
      event.publishedAt === null
    ) {
      throw new Error('Published event state is incomplete');
    }

    return {
      eventId: event.eventId,
      title: event.title,
      description: event.description,
      category: event.categories[0]!,
      categories: event.categories,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timeZone: event.timeZone,
      venue: {
        name: event.venue.name,
        addressLine1: event.venue.addressLine1,
        addressLine2: event.venue.addressLine2 ?? undefined,
        addressLineOne: event.venue.addressLine1,
        addressLineTwo: event.venue.addressLine2 ?? undefined,
        city: event.venue.city,
        region: event.venue.region ?? undefined,
        regionCode: event.venue.regionCode ?? undefined,
        postalCode: event.venue.postalCode ?? undefined,
        countryCode: event.venue.countryCode,
      },
      media: event.media.map((media) => ({
        mediaId: media.mediaId,
        slot: this.toContractSlot(media.slot),
        url: `${this.config.cloudflareR2PublicBaseUrl}/${media.objectKey}`,
        contentType: media.contentType,
        sizeBytes: media.sizeBytes,
        width: media.width,
        height: media.height,
      })),
      publishedAt: event.publishedAt.toISOString(),
      version: event.version,
    };
  }

  private toDomainSlot(slot: EventMediaSlot): DomainEventMediaSlot {
    switch (slot) {
      case EventMediaSlot.EVENT_MEDIA_SLOT_COVER:
        return 'cover';
      case EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_1:
        return 'gallery_1';
      case EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_2:
        return 'gallery_2';
      case EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_3:
        return 'gallery_3';
      case EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_4:
        return 'gallery_4';
      default:
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'Event media slot is invalid',
        });
    }
  }

  private toDomainSort(sort: AdminEventSort): DomainAdminEventSort {
    switch (sort) {
      case AdminEventSort.ADMIN_EVENT_SORT_UPDATED_DESC:
        return 'updated_desc';
      case AdminEventSort.ADMIN_EVENT_SORT_EVENT_DATE_ASC:
        return 'event_date_asc';
      case AdminEventSort.ADMIN_EVENT_SORT_EVENT_DATE_DESC:
        return 'event_date_desc';
      default:
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'Event sort is invalid',
        });
    }
  }

  private toContractSlot(slot: DomainEventMediaSlot): EventMediaSlot {
    return {
      cover: EventMediaSlot.EVENT_MEDIA_SLOT_COVER,
      gallery_1: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_1,
      gallery_2: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_2,
      gallery_3: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_3,
      gallery_4: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_4,
    }[slot];
  }

  private toContractUploadStatus(
    uploadStatus: DomainEventMediaUploadStatus,
  ): EventMediaUploadStatus {
    return {
      pending: EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_PENDING,
      attached: EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_ATTACHED,
      rejected: EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_REJECTED,
      conflict: EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_CONFLICT,
      expired: EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_EXPIRED,
    }[uploadStatus];
  }
}
