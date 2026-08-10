import {
  EVENT_SERVICE_NAME,
  EventMediaSlot,
  type PublishedEvent,
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
  PublishedEventDto,
  PublishedEventMediaDto,
} from '../dto/published-event.dto';
import type { DeadlineAwareEventServiceClient } from '../types/event-grpc-client.types';

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class PublishedEventService implements OnModuleInit {
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

  async getById(
    eventId: string,
    requestId: string,
  ): Promise<PublishedEventDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().getPublishedEvent(
          { eventId },
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      return this.toPublishedEvent(response.event);
    } catch (error: unknown) {
      if (readErrorCode(error) === status.NOT_FOUND) {
        throw new ApiHttpException(
          HttpStatus.NOT_FOUND,
          'EVENT_NOT_FOUND',
          'Event was not found.',
        );
      }
      if (readErrorCode(error) === status.DEADLINE_EXCEEDED) {
        throw this.unavailable('EVENT_READ_RPC_DEADLINE_EXCEEDED');
      }
      if (error instanceof ApiHttpException) {
        throw error;
      }
      throw this.unavailable('EVENT_READ_RPC_UNAVAILABLE');
    }
  }

  private toPublishedEvent(
    event: PublishedEvent | undefined,
  ): PublishedEventDto {
    if (
      event === undefined ||
      event.eventId === '' ||
      event.title === '' ||
      event.description === '' ||
      event.category === '' ||
      event.startsAt === '' ||
      event.endsAt === '' ||
      event.timeZone === '' ||
      event.venue === undefined ||
      event.publishedAt === '' ||
      !Number.isInteger(event.version) ||
      event.version < 2
    ) {
      throw this.unavailable('PUBLISHED_EVENT_RESPONSE_INVALID');
    }

    return {
      ...event,
      venue: {
        name: event.venue.name,
        addressLine1: event.venue.addressLine1,
        ...(event.venue.addressLine2 === undefined
          ? {}
          : { addressLine2: event.venue.addressLine2 }),
        city: event.venue.city,
        ...(event.venue.region === undefined
          ? {}
          : { region: event.venue.region }),
        ...(event.venue.postalCode === undefined
          ? {}
          : { postalCode: event.venue.postalCode }),
        countryCode: event.venue.countryCode,
      },
      media: event.media.map((media) => ({
        ...media,
        slot: this.toPublicMediaSlot(media.slot),
        contentType: this.toPublicContentType(media.contentType),
      })),
    };
  }

  private toPublicMediaSlot(
    slot: EventMediaSlot,
  ): PublishedEventMediaDto['slot'] {
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
        throw this.unavailable('PUBLISHED_EVENT_MEDIA_SLOT_INVALID');
    }
  }

  private toPublicContentType(
    contentType: string,
  ): PublishedEventMediaDto['contentType'] {
    if (
      contentType !== 'image/jpeg' &&
      contentType !== 'image/png' &&
      contentType !== 'image/webp'
    ) {
      throw this.unavailable('PUBLISHED_EVENT_MEDIA_CONTENT_TYPE_INVALID');
    }
    return contentType;
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

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'EVENT_SERVICE_UNAVAILABLE',
      'Event details are temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
