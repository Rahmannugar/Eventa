import {
  EVENT_SERVICE_NAME,
  EventMediaSlot,
  EventMediaUploadStatus,
  EventStatus,
  type AdminEventSummary,
  type Event,
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
  AdminEventSummaryDto,
  CreateDraftEventDto,
  CreateEventMediaUploadDto,
  EventMediaUploadIntentDto,
  EventMediaUploadStatusDto,
  RemoveEventMediaResponseDto,
  PublishEventDto,
  UpdateDraftEventDto,
} from '../dto/admin-event.dto';
import type { DeadlineAwareEventServiceClient } from '../types/event-grpc-client.types';

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
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
    limit: number,
    cursor: string | undefined,
    requestId: string,
  ): Promise<AdminEventListDto> {
    const events = this.requireClient();

    try {
      const response = await firstValueFrom(
        events.listAdminEvents(
          {
            pageSize: limit,
            ...(cursor === undefined ? {} : { pageToken: cursor }),
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

  private toAdminVenue(venue: Venue): AdminEventDto['venue'] {
    const addressLine2 = venue.addressLineTwo ?? venue.addressLine2;
    return {
      name: venue.name,
      addressLine1: venue.addressLineOne || venue.addressLine1,
      ...(addressLine2 === undefined ? {} : { addressLine2 }),
      city: venue.city,
      ...(venue.region === undefined ? {} : { region: venue.region }),
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
            : 'EVENT_NOT_FOUND',
          operation === 'media_status'
            ? 'Media upload was not found.'
            : 'Event was not found.',
        );
      case status.INVALID_ARGUMENT:
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
        if (operation === 'publish') {
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'EVENT_PUBLICATION_INCOMPLETE',
            'Complete the event details, venue, and cover image before publishing.',
          );
        }
        if (operation === 'media_remove') {
          throw new ApiHttpException(
            HttpStatus.NOT_FOUND,
            'EVENT_MEDIA_NOT_FOUND',
            'That event media slot is empty.',
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
