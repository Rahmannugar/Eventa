import { randomUUID } from 'node:crypto';

import {
  EventMediaSlot,
  EventMediaUploadStatus,
  EventServiceControllerMethods,
  EventStatus,
  type CreateDraftEventResponse,
  type CreateEventMediaUploadResponse,
  type Event,
  type EventServiceController,
  type GetAdminEventResponse,
  type GetEventMediaUploadResponse,
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
} from '../constants/event.constants';
import {
  CreateDraftEventDto,
  CreateEventMediaUploadDto,
  GetAdminEventDto,
  GetEventMediaUploadDto,
  UpdateDraftEventDto,
} from '../dto/event.dto';
import {
  EventMediaSlotOccupiedError,
  EventMediaUploadInProgressError,
  EventMediaUploadNotFoundError,
  EventNotFoundError,
  EventScheduleInvalidError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  EventManagement,
  EventMediaManagement,
  EventMediaSlot as DomainEventMediaSlot,
  EventMediaUploadStatus as DomainEventMediaUploadStatus,
  EventRecord,
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
    @Inject(RUNTIME_CONFIG)
    private readonly config: RuntimeConfig,
  ) {}

  createDraftEvent(
    request: CreateDraftEventDto,
    metadata?: Metadata,
  ): Observable<CreateDraftEventResponse> {
    return from(
      this.eventService
        .createDraft(
          request.adminId,
          request.title,
          this.readRequestId(metadata),
        )
        .then((event) => ({ event: this.toContract(event) })),
    );
  }

  getAdminEvent(request: GetAdminEventDto): Observable<GetAdminEventResponse> {
    return from(this.getEvent(request.eventId));
  }

  updateDraftEvent(
    request: UpdateDraftEventDto,
    metadata?: Metadata,
  ): Observable<UpdateDraftEventResponse> {
    return from(this.updateEvent(request, this.readRequestId(metadata)));
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

  private async updateEvent(
    request: UpdateDraftEventDto,
    requestId: string,
  ): Promise<UpdateDraftEventResponse> {
    const { adminId, ...details } = request;
    try {
      return {
        event: this.toContract(
          await this.eventService.updateDraft({
            ...details,
            actorAdminId: adminId,
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
      if (error instanceof EventScheduleInvalidError) {
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
      if (error instanceof EventMediaSlotOccupiedError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
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
      category: event.category ?? undefined,
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
              city: event.venue.city,
              region: event.venue.region ?? undefined,
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
      status: EventStatus.EVENT_STATUS_DRAFT,
      version: event.version,
      createdByAdminId: event.createdByAdminId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
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
