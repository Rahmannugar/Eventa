import {
  EVENT_SERVICE_NAME,
  AdminEventSort,
  EventMediaSlot,
  EventMediaUploadStatus,
  EventStatus,
  type AdminEventSummary,
  type Event,
  type EventTicketType,
  type EventTicketCurrency,
  type Venue,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import {
  EVENT_GRPC_CLIENT,
  EVENT_GRPC_DEADLINE_MS,
} from '../constants/event.constants';
import type {
  AdminEventDto,
  AdminEventListDto,
  AdminEventListQueryDto,
  AdminEventSummaryDto,
  CreateDraftEventDto,
  CreateEventMediaUploadDto,
  CreateEventTicketTypeDto,
  CreateEventTicketTypeResponseDto,
  DefineEventTicketCurrencyDto,
  DefineEventTicketCurrencyResponseDto,
  EventMediaUploadIntentDto,
  EventMediaUploadStatusDto,
  EventTicketTypeDto,
  EventTicketTypeListDto,
  RemoveEventMediaResponseDto,
  RetireDraftEventResponseDto,
  RetireEventTicketTypeResponseDto,
  PublishEventDto,
  UpdateDraftEventDto,
  UpdateEventTicketTypeDto,
  UpdateEventTicketTypeResponseDto,
} from '../dto/admin-event.dto';
import type { DeadlineAwareEventServiceClient } from '../types/event-grpc-client.types';

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const details: unknown = Reflect.get(error, 'details');
  return typeof details === 'string' ? details : undefined;
}

@Injectable()
export class AdminEventService implements OnModuleInit {
  private events?: DeadlineAwareEventServiceClient;

  constructor(
    @Inject(EVENT_GRPC_CLIENT)
    private readonly grpcClient: ClientGrpc,
    @Inject(EVENT_GRPC_DEADLINE_MS)
    private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.events =
      this.grpcClient.getService<DeadlineAwareEventServiceClient>(
        EVENT_SERVICE_NAME,
      );
  }

  async createDraft(
    adminId: string,
    input: CreateDraftEventDto,
    requestId: string,
  ): Promise<AdminEventDto> {
    const events = this.requireClient();

    try {
      const response = await firstValueFrom(
        events.createDraftEvent(
          {
            adminId,
            ...input,
            venue: {
              ...input.venue,
              addressLineOne: input.venue.addressLine1,
              addressLineTwo: input.venue.addressLine2,
            },
          },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      return this.toAdminEvent(response.event);
    } catch (error: unknown) {
      this.translate(error, 'create');
    }
  }

  async list(
    query: AdminEventListQueryDto,
    requestId: string,
  ): Promise<AdminEventListDto> {
    const events = this.requireClient();

    if (query.regionCode !== undefined && query.countryCode === undefined) {
      throw new ApiHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'Check the request and try again.',
        {
          errors: [
            {
              field: 'regionCode',
              code: 'COUNTRY_REQUIRED',
              message: 'Choose a country before choosing a state or region.',
            },
          ],
        },
      );
    }

    try {
      const response = await firstValueFrom(
        events.listAdminEvents(
          {
            pageSize: query.limit,
            ...(query.cursor === undefined ? {} : { pageToken: query.cursor }),
            ...(query.search === undefined ? {} : { search: query.search }),
            ...(query.countryCode === undefined
              ? {}
              : { countryCode: query.countryCode }),
            ...(query.regionCode === undefined
              ? {}
              : { regionCode: query.regionCode }),
            sort: this.toContractSort(query.sort),
          },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      return {
        events: (response.events ?? []).map((event) =>
          this.toAdminEventSummary(event),
        ),
        ...(response.nextPageToken === undefined
          ? {}
          : { nextCursor: response.nextPageToken }),
      };
    } catch (error: unknown) {
      this.translate(error, 'read');
    }
  }

  async getById(eventId: string, requestId: string): Promise<AdminEventDto> {
    const events = this.requireClient();

    try {
      const response = await firstValueFrom(
        events.getAdminEvent(
          { eventId },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      return this.toAdminEvent(response.event);
    } catch (error: unknown) {
      this.translate(error, 'read');
    }
  }

  async updateDraft(
    adminId: string,
    eventId: string,
    input: UpdateDraftEventDto,
    requestId: string,
  ): Promise<AdminEventDto> {
    const events = this.requireClient();

    try {
      const response = await firstValueFrom(
        events.updateDraftEvent(
          {
            adminId,
            eventId,
            ...input,
            category: input.categories[0] ?? '',
            venue: {
              ...input.venue,
              addressLineOne: input.venue.addressLine1,
              addressLineTwo: input.venue.addressLine2,
            },
          },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      return this.toAdminEvent(response.event);
    } catch (error: unknown) {
      this.translate(error, 'update');
    }
  }

  async createMediaUpload(
    adminId: string,
    eventId: string,
    input: CreateEventMediaUploadDto,
    requestId: string,
  ): Promise<EventMediaUploadIntentDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.createEventMediaUpload(
          {
            adminId,
            eventId,
            expectedVersion: input.expectedVersion,
            slot: this.toContractMediaSlot(input.slot),
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
          },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (
        response.uploadId === '' ||
        response.uploadUrl === '' ||
        response.expiresAt === '' ||
        response.verificationDeadlineAt === '' ||
        Object.keys(response.requiredHeaders).length === 0
      ) {
        throw this.unavailable('EVENT_MEDIA_UPLOAD_RESPONSE_INVALID');
      }
      return response;
    } catch (error: unknown) {
      this.translate(error, 'media_upload');
    }
  }

  async getMediaUpload(
    eventId: string,
    uploadId: string,
    requestId: string,
  ): Promise<EventMediaUploadStatusDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.getEventMediaUpload(
          { eventId, uploadId },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      const statusValue = this.toPublicUploadStatus(response.status);
      const slot = this.toPublicMediaSlot(response.slot);
      if (
        response.uploadId === '' ||
        response.expiresAt === '' ||
        response.verificationDeadlineAt === ''
      ) {
        throw this.unavailable('EVENT_MEDIA_STATUS_RESPONSE_INVALID');
      }
      return {
        uploadId: response.uploadId,
        status: statusValue,
        slot,
        expiresAt: response.expiresAt,
        verificationDeadlineAt: response.verificationDeadlineAt,
        ...(response.attachedEventVersion === undefined
          ? {}
          : { attachedEventVersion: response.attachedEventVersion }),
        ...(response.failureCode === undefined
          ? {}
          : { failureCode: response.failureCode }),
      };
    } catch (error: unknown) {
      this.translate(error, 'media_status');
    }
  }

  async removeMedia(
    adminId: string,
    eventId: string,
    slot: CreateEventMediaUploadDto['slot'],
    expectedVersion: number,
    requestId: string,
  ): Promise<RemoveEventMediaResponseDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.removeEventMedia(
          {
            adminId,
            eventId,
            expectedVersion,
            slot: this.toContractMediaSlot(slot),
          },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (
        !Number.isInteger(response.eventVersion) ||
        response.eventVersion < 2
      ) {
        throw this.unavailable('EVENT_MEDIA_REMOVE_RESPONSE_INVALID');
      }
      return response;
    } catch (error: unknown) {
      this.translate(error, 'media_remove');
    }
  }

  async createTicketType(
    adminId: string,
    eventId: string,
    input: CreateEventTicketTypeDto,
    requestId: string,
  ): Promise<CreateEventTicketTypeResponseDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.addEventTicketType(
          {
            adminId,
            eventId,
            ...input,
          },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (response.ticketType === undefined || response.eventVersion < 2) {
        throw this.unavailable('EVENT_TICKET_TYPE_RESPONSE_INVALID');
      }
      if (response.ticketType.eventId !== eventId) {
        throw this.unavailable('EVENT_TICKET_TYPE_RESPONSE_INVALID');
      }
      return {
        eventVersion: response.eventVersion,
        ticketType: this.toEventTicketType(response.ticketType),
      };
    } catch (error: unknown) {
      this.translate(error, 'ticket_type');
    }
  }

  async defineTicketCurrency(
    adminId: string,
    eventId: string,
    input: DefineEventTicketCurrencyDto,
    requestId: string,
  ): Promise<DefineEventTicketCurrencyResponseDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.defineEventTicketCurrency(
          { adminId, eventId, ...input },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (
        response.ticketCurrency === undefined ||
        response.eventVersion < 2 ||
        response.ticketCurrency.eventId !== eventId
      ) {
        throw this.unavailable('EVENT_TICKET_CURRENCY_RESPONSE_INVALID');
      }
      return {
        eventVersion: response.eventVersion,
        ticketCurrency: this.toEventTicketCurrency(response.ticketCurrency),
      };
    } catch (error: unknown) {
      this.translate(error, 'ticket_currency');
    }
  }

  async updateTicketType(
    adminId: string,
    eventId: string,
    ticketTypeId: string,
    input: UpdateEventTicketTypeDto,
    requestId: string,
  ): Promise<UpdateEventTicketTypeResponseDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.updateEventTicketType(
          { adminId, eventId, ticketTypeId, ...input },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (
        response.ticketType === undefined ||
        response.eventVersion < 2 ||
        response.ticketType.eventId !== eventId ||
        response.ticketType.ticketTypeId !== ticketTypeId
      ) {
        throw this.unavailable('EVENT_TICKET_TYPE_UPDATE_RESPONSE_INVALID');
      }
      return {
        eventVersion: response.eventVersion,
        ticketType: this.toEventTicketType(response.ticketType),
      };
    } catch (error: unknown) {
      this.translate(error, 'ticket_type_update');
    }
  }

  async retireTicketType(
    adminId: string,
    eventId: string,
    ticketTypeId: string,
    expectedVersion: number,
    requestId: string,
  ): Promise<RetireEventTicketTypeResponseDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.retireEventTicketType(
          { adminId, eventId, expectedVersion, ticketTypeId },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (
        !Number.isInteger(response.eventVersion) ||
        response.eventVersion < 2
      ) {
        throw this.unavailable('EVENT_TICKET_TYPE_RETIRE_RESPONSE_INVALID');
      }
      return response;
    } catch (error: unknown) {
      this.translate(error, 'ticket_type_retire');
    }
  }

  async listTicketTypes(
    eventId: string,
    requestId: string,
  ): Promise<EventTicketTypeListDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.getEventTicketCatalogue(
          { eventId },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (response.eventVersion < 1) {
        throw this.unavailable('EVENT_TICKET_TYPE_LIST_RESPONSE_INVALID');
      }
      const ticketCurrencies = (response.ticketCurrencies ?? []).map(
        (ticketCurrency) => {
          if (ticketCurrency.eventId !== eventId) {
            throw this.unavailable('EVENT_TICKET_TYPE_LIST_RESPONSE_INVALID');
          }
          return this.toEventTicketCurrency(ticketCurrency);
        },
      );
      const currencyIds = new Set(
        ticketCurrencies.map(({ ticketCurrencyId }) => ticketCurrencyId),
      );
      return {
        eventVersion: response.eventVersion,
        ticketCurrencies,
        ticketTypes: (response.ticketTypes ?? []).map((ticketType) => {
          if (
            ticketType.eventId !== eventId ||
            !currencyIds.has(ticketType.ticketCurrencyId)
          ) {
            throw this.unavailable('EVENT_TICKET_TYPE_LIST_RESPONSE_INVALID');
          }
          return this.toEventTicketType(ticketType);
        }),
      };
    } catch (error: unknown) {
      this.translate(error, 'ticket_type_read');
    }
  }

  async publish(
    adminId: string,
    eventId: string,
    input: PublishEventDto,
    requestId: string,
  ): Promise<AdminEventDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.publishEvent(
          { adminId, eventId, expectedVersion: input.expectedVersion },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      return this.toAdminEvent(response.event);
    } catch (error: unknown) {
      this.translate(error, 'publish');
    }
  }

  async retire(
    adminId: string,
    eventId: string,
    expectedVersion: number,
    requestId: string,
  ): Promise<RetireDraftEventResponseDto> {
    const events = this.requireClient();
    try {
      const response = await firstValueFrom(
        events.retireDraftEvent(
          { adminId, eventId, expectedVersion },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      if (
        !Number.isInteger(response.eventVersion) ||
        response.eventVersion < 2
      ) {
        throw this.unavailable('EVENT_RETIRE_RESPONSE_INVALID');
      }
      return response;
    } catch (error: unknown) {
      this.translate(error, 'retire');
    }
  }

  private deadline() {
    return { deadline: new Date(Date.now() + this.deadlineMs) };
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private requireClient(): DeadlineAwareEventServiceClient {
    if (this.events === undefined) {
      throw this.unavailable('EVENT_CLIENT_UNAVAILABLE');
    }

    return this.events;
  }

  private toAdminEvent(event: Event | undefined): AdminEventDto {
    if (
      event === undefined ||
      ![
        EventStatus.EVENT_STATUS_DRAFT,
        EventStatus.EVENT_STATUS_PUBLISHED,
      ].includes(event.status) ||
      !Number.isInteger(event.version) ||
      event.version < 1 ||
      (event.status === EventStatus.EVENT_STATUS_PUBLISHED) !==
        (event.publishedAt !== undefined && event.publishedAt !== '')
    ) {
      throw this.unavailable('EVENT_RESPONSE_INVALID');
    }

    return {
      eventId: event.eventId,
      title: event.title,
      description: event.description,
      categories: event.categories ?? [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: event.timeZone,
      venue:
        event.venue === undefined ? undefined : this.toAdminVenue(event.venue),
      media: (event.media ?? []).map((media) => ({
        mediaId: media.mediaId,
        slot: this.toPublicMediaSlot(media.slot),
        url: media.url,
        contentType: this.toPublicContentType(media.contentType),
        sizeBytes: media.sizeBytes,
        width: media.width,
        height: media.height,
      })),
      status:
        event.status === EventStatus.EVENT_STATUS_PUBLISHED
          ? 'published'
          : 'draft',
      version: event.version,
      createdByAdminId: event.createdByAdminId,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      publishedAt: event.publishedAt,
    };
  }

  private toAdminEventSummary(event: AdminEventSummary): AdminEventSummaryDto {
    if (
      event.eventId === '' ||
      event.title === '' ||
      event.updatedAt === '' ||
      ![
        EventStatus.EVENT_STATUS_DRAFT,
        EventStatus.EVENT_STATUS_PUBLISHED,
      ].includes(event.status)
    ) {
      throw this.unavailable('EVENT_LIST_RESPONSE_INVALID');
    }

    return {
      eventId: event.eventId,
      title: event.title,
      categories: event.categories ?? [],
      status:
        event.status === EventStatus.EVENT_STATUS_PUBLISHED
          ? 'published'
          : 'draft',
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: event.timeZone,
      venue:
        event.venue === undefined ? undefined : this.toAdminVenue(event.venue),
      updatedAt: event.updatedAt,
    };
  }

  private toEventTicketType(ticketType: EventTicketType): EventTicketTypeDto {
    if (
      ticketType.ticketTypeId === '' ||
      ticketType.eventId === '' ||
      ticketType.name === '' ||
      ticketType.salesStartAt === '' ||
      ticketType.salesEndAt === '' ||
      ticketType.createdAt === '' ||
      ticketType.updatedAt === '' ||
      !Number.isInteger(ticketType.priceMinor) ||
      ticketType.priceMinor < 0 ||
      !Number.isInteger(ticketType.capacity) ||
      ticketType.capacity < 1 ||
      !Number.isInteger(ticketType.reservedQuantity) ||
      ticketType.reservedQuantity < 0 ||
      !Number.isInteger(ticketType.soldQuantity) ||
      ticketType.soldQuantity < 0 ||
      ticketType.availableQuantity !==
        ticketType.capacity -
          ticketType.reservedQuantity -
          ticketType.soldQuantity ||
      ticketType.availableQuantity < 0 ||
      ticketType.ticketCurrencyId === ''
    ) {
      throw this.unavailable('EVENT_TICKET_TYPE_RESPONSE_INVALID');
    }
    return {
      capacity: ticketType.capacity,
      reservedQuantity: ticketType.reservedQuantity,
      soldQuantity: ticketType.soldQuantity,
      availableQuantity: ticketType.availableQuantity,
      createdAt: ticketType.createdAt,
      description: ticketType.description,
      eventId: ticketType.eventId,
      name: ticketType.name,
      priceMinor: ticketType.priceMinor,
      salesEndAt: ticketType.salesEndAt,
      salesStartAt: ticketType.salesStartAt,
      ticketCurrencyId: ticketType.ticketCurrencyId,
      ticketTypeId: ticketType.ticketTypeId,
      updatedAt: ticketType.updatedAt,
    };
  }

  private toEventTicketCurrency(
    ticketCurrency: EventTicketCurrency,
  ): DefineEventTicketCurrencyResponseDto['ticketCurrency'] {
    if (
      ticketCurrency.ticketCurrencyId === '' ||
      ticketCurrency.eventId === '' ||
      !/^[A-Z]{3}$/.test(ticketCurrency.currency) ||
      ticketCurrency.createdAt === '' ||
      ticketCurrency.updatedAt === ''
    ) {
      throw this.unavailable('EVENT_TICKET_CURRENCY_RESPONSE_INVALID');
    }
    return ticketCurrency;
  }

  private toAdminVenue(venue: Venue): AdminEventDto['venue'] {
    const addressLine2 = venue.addressLineTwo ?? venue.addressLine2;
    return {
      name: venue.name,
      addressLine1: venue.addressLineOne || venue.addressLine1,
      ...(addressLine2 === undefined ? {} : { addressLine2 }),
      city: venue.city,
      ...(venue.region === undefined ? {} : { region: venue.region }),
      ...(venue.regionCode === undefined
        ? {}
        : { regionCode: venue.regionCode }),
      ...(venue.postalCode === undefined
        ? {}
        : { postalCode: venue.postalCode }),
      countryCode: venue.countryCode,
    };
  }

  private translate(
    error: unknown,
    operation:
      | 'create'
      | 'media_remove'
      | 'media_status'
      | 'media_upload'
      | 'read'
      | 'publish'
      | 'retire'
      | 'ticket_type'
      | 'ticket_type_update'
      | 'ticket_type_retire'
      | 'ticket_type_read'
      | 'ticket_currency'
      | 'update',
  ): never {
    if (error instanceof ApiHttpException) {
      throw error;
    }

    switch (readErrorCode(error)) {
      case status.NOT_FOUND:
        throw new ApiHttpException(
          HttpStatus.NOT_FOUND,
          operation === 'media_status'
            ? 'EVENT_MEDIA_UPLOAD_NOT_FOUND'
            : operation === 'ticket_type_update' ||
                operation === 'ticket_type_retire'
              ? 'EVENT_TICKET_TYPE_NOT_FOUND'
              : 'EVENT_NOT_FOUND',
          operation === 'media_status'
            ? 'Media upload was not found.'
            : operation === 'ticket_type_update' ||
                operation === 'ticket_type_retire'
              ? 'Ticket type was not found.'
              : 'Event was not found.',
        );
      case status.INVALID_ARGUMENT:
        if (operation === 'ticket_currency') {
          const duplicate =
            readErrorMessage(error) === 'EVENT_TICKET_CURRENCY_CONFLICT';
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            duplicate ? 'EVENT_TICKET_CURRENCY_CONFLICT' : 'VALIDATION_FAILED',
            duplicate
              ? 'That currency is already defined for this event.'
              : 'Choose a valid currency.',
          );
        }
        if (operation === 'ticket_type' || operation === 'ticket_type_update') {
          const message = readErrorMessage(error);
          const nameConflict = message === 'EVENT_TICKET_TYPE_NAME_CONFLICT';
          const currencyMissing = message === 'EVENT_TICKET_CURRENCY_NOT_FOUND';
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            nameConflict
              ? 'EVENT_TICKET_TYPE_NAME_CONFLICT'
              : currencyMissing
                ? 'EVENT_TICKET_CURRENCY_NOT_FOUND'
                : 'VALIDATION_FAILED',
            nameConflict
              ? 'Use a different ticket type name.'
              : currencyMissing
                ? 'Choose a currency defined for this event.'
                : 'Check the ticket details and try again.',
          );
        }
        throw new ApiHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Check the event fields and try again.',
          { diagnosticCode: 'EVENT_VALIDATION_FAILED' },
        );
      case status.ABORTED:
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'EVENT_VERSION_CONFLICT',
          'The event changed. Reload it and apply your changes again.',
        );
      case status.FAILED_PRECONDITION:
        if (operation === 'ticket_currency') {
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'EVENT_TICKET_CURRENCY_MUTATION_NOT_ALLOWED',
            'Currencies can only be defined while the event is a draft.',
          );
        }
        if (operation === 'ticket_type') {
          const limitReached =
            readErrorMessage(error) === 'EVENT_TICKET_TYPE_LIMIT_REACHED';
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            limitReached
              ? 'EVENT_TICKET_TYPE_LIMIT_REACHED'
              : 'EVENT_TICKET_TYPE_MUTATION_NOT_ALLOWED',
            limitReached
              ? 'This event already has the maximum number of ticket types.'
              : 'Ticket types can only be added while the event is a draft.',
          );
        }
        if (operation === 'ticket_type_update') {
          const message = readErrorMessage(error);
          const capacityLocked =
            message === 'EVENT_TICKET_TYPE_CAPACITY_BELOW_COMMITTED';
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            capacityLocked
              ? 'EVENT_TICKET_TYPE_CAPACITY_BELOW_COMMITTED'
              : 'EVENT_TICKET_TYPE_COMMERCIAL_TERMS_LOCKED',
            capacityLocked
              ? 'Capacity cannot be lower than the number already reserved or sold.'
              : 'Price and sales dates cannot change while tickets are reserved or sold.',
          );
        }
        if (operation === 'ticket_type_retire') {
          const lastType =
            readErrorMessage(error) === 'EVENT_TICKET_TYPE_LAST_PUBLISHED_TYPE';
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            lastType
              ? 'EVENT_TICKET_TYPE_LAST_PUBLISHED_TYPE'
              : 'EVENT_TICKET_TYPE_HAS_COMMITTED_INVENTORY',
            lastType
              ? 'A published event must keep at least one ticket type.'
              : 'A ticket type with reserved or sold tickets cannot be retired.',
          );
        }
        if (operation === 'publish') {
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'EVENT_PUBLICATION_INCOMPLETE',
            'Complete the event details, venue, cover image, and tickets before publishing.',
          );
        }
        if (operation === 'media_remove') {
          throw new ApiHttpException(
            HttpStatus.NOT_FOUND,
            'EVENT_MEDIA_NOT_FOUND',
            'That event media slot is empty.',
          );
        }
        if (operation === 'retire') {
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'EVENT_RETIREMENT_NOT_ALLOWED',
            'Published events cannot be removed.',
          );
        }
        throw this.unavailable('EVENT_MEDIA_PRECONDITION_INVALID');
      case status.ALREADY_EXISTS:
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'EVENT_MEDIA_UPLOAD_IN_PROGRESS',
          'An upload is already in progress for that media slot.',
        );
      case status.DEADLINE_EXCEEDED:
        throw this.unavailable('EVENT_RPC_DEADLINE_EXCEEDED');
      default:
        throw this.unavailable(
          operation === 'create'
            ? 'EVENT_CREATE_RPC_UNAVAILABLE'
            : operation === 'media_upload'
              ? 'EVENT_MEDIA_UPLOAD_RPC_UNAVAILABLE'
              : operation === 'media_remove'
                ? 'EVENT_MEDIA_REMOVE_RPC_UNAVAILABLE'
                : operation === 'media_status'
                  ? 'EVENT_MEDIA_STATUS_RPC_UNAVAILABLE'
                  : operation === 'update'
                    ? 'EVENT_UPDATE_RPC_UNAVAILABLE'
                    : operation === 'publish'
                      ? 'EVENT_PUBLISH_RPC_UNAVAILABLE'
                      : operation === 'retire'
                        ? 'EVENT_RETIRE_RPC_UNAVAILABLE'
                        : operation === 'ticket_type'
                          ? 'EVENT_TICKET_TYPE_RPC_UNAVAILABLE'
                          : operation === 'ticket_type_update'
                            ? 'EVENT_TICKET_TYPE_UPDATE_RPC_UNAVAILABLE'
                            : operation === 'ticket_type_retire'
                              ? 'EVENT_TICKET_TYPE_RETIRE_RPC_UNAVAILABLE'
                              : operation === 'ticket_currency'
                                ? 'EVENT_TICKET_CURRENCY_RPC_UNAVAILABLE'
                                : operation === 'ticket_type_read'
                                  ? 'EVENT_TICKET_TYPE_READ_RPC_UNAVAILABLE'
                                  : 'EVENT_READ_RPC_UNAVAILABLE',
        );
    }
  }

  private toContractMediaSlot(
    slot: CreateEventMediaUploadDto['slot'],
  ): EventMediaSlot {
    return {
      cover: EventMediaSlot.EVENT_MEDIA_SLOT_COVER,
      gallery_1: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_1,
      gallery_2: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_2,
      gallery_3: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_3,
      gallery_4: EventMediaSlot.EVENT_MEDIA_SLOT_GALLERY_4,
    }[slot];
  }

  private toContractSort(sort: AdminEventListQueryDto['sort']): AdminEventSort {
    return {
      updated_desc: AdminEventSort.ADMIN_EVENT_SORT_UPDATED_DESC,
      event_date_asc: AdminEventSort.ADMIN_EVENT_SORT_EVENT_DATE_ASC,
      event_date_desc: AdminEventSort.ADMIN_EVENT_SORT_EVENT_DATE_DESC,
    }[sort];
  }

  private toPublicMediaSlot(
    slot: EventMediaSlot,
  ): CreateEventMediaUploadDto['slot'] {
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
        throw this.unavailable('EVENT_MEDIA_SLOT_INVALID');
    }
  }

  private toPublicUploadStatus(
    uploadStatus: EventMediaUploadStatus,
  ): EventMediaUploadStatusDto['status'] {
    switch (uploadStatus) {
      case EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_PENDING:
        return 'pending';
      case EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_ATTACHED:
        return 'attached';
      case EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_REJECTED:
        return 'rejected';
      case EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_CONFLICT:
        return 'conflict';
      case EventMediaUploadStatus.EVENT_MEDIA_UPLOAD_STATUS_EXPIRED:
        return 'expired';
      default:
        throw this.unavailable('EVENT_MEDIA_UPLOAD_STATUS_INVALID');
    }
  }

  private toPublicContentType(
    value: string,
  ): 'image/jpeg' | 'image/png' | 'image/webp' {
    if (
      value === 'image/jpeg' ||
      value === 'image/png' ||
      value === 'image/webp'
    ) {
      return value;
    }
    throw this.unavailable('EVENT_MEDIA_CONTENT_TYPE_INVALID');
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'EVENT_SERVICE_UNAVAILABLE',
      'Event management is temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
