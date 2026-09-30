import {
  DISCOVERY_SERVICE_NAME,
  type EventSearchResult,
  type SimilarEventsResponse,
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
  DISCOVERY_GRPC_CLIENT,
  DISCOVERY_GRPC_DEADLINE_MS,
} from '../constants/discovery.constants';
import type {
  SimilarEventsDto,
  SimilarEventsQueryDto,
} from '../dto/discovery-similar.dto';
import type { SearchEventResultDto } from '../dto/discovery-search.dto';
import type { DeadlineAwareDiscoveryClient } from '../types/discovery-grpc-client.types';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class DiscoverySimilarEventsService implements OnModuleInit {
  private discovery?: DeadlineAwareDiscoveryClient;

  constructor(
    @Inject(DISCOVERY_GRPC_CLIENT) private readonly grpcClient: ClientGrpc,
    @Inject(DISCOVERY_GRPC_DEADLINE_MS) private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.discovery = this.grpcClient.getService<DeadlineAwareDiscoveryClient>(
      DISCOVERY_SERVICE_NAME,
    );
  }

  async similar(
    eventId: string,
    query: SimilarEventsQueryDto,
    requestId: string,
  ): Promise<SimilarEventsDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().similarEvents(
          { eventId, limit: query.limit },
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      return this.toDto(response, eventId);
    } catch (error: unknown) {
      throw this.translate(error);
    }
  }

  // toDto re-reads the response rather than trusting it: an answer for a
  // different event, or one without its events, is not safe to return as this
  // caller's similar events.
  private toDto(
    response: SimilarEventsResponse,
    eventId: string,
  ): SimilarEventsDto {
    if (response.eventId !== eventId || !Array.isArray(response.events)) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DISCOVERY_SERVICE_UNAVAILABLE',
        'Similar events are temporarily unavailable. Try again later.',
        { diagnosticCode: 'DISCOVERY_SIMILAR_RESPONSE_INVALID' },
      );
    }
    return { events: response.events.map(toEventDto) };
  }

  private translate(error: unknown): unknown {
    if (error instanceof ApiHttpException) return error;
    if (errorCode(error) === status.NOT_FOUND) {
      return new ApiHttpException(
        HttpStatus.NOT_FOUND,
        'EVENT_NOT_FOUND',
        'That event is no longer available.',
      );
    }
    if (errorCode(error) === status.INVALID_ARGUMENT) {
      return new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        'SIMILAR_EVENTS_INVALID',
        'Those events could not be loaded.',
      );
    }
    if (errorCode(error) === status.DEADLINE_EXCEEDED) {
      return new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DISCOVERY_SERVICE_UNAVAILABLE',
        'Similar events are temporarily unavailable. Try again later.',
        { diagnosticCode: 'DISCOVERY_SIMILAR_RPC_DEADLINE_EXCEEDED' },
      );
    }
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'DISCOVERY_SERVICE_UNAVAILABLE',
      'Similar events are temporarily unavailable. Try again later.',
      { diagnosticCode: 'DISCOVERY_SIMILAR_RPC_UNAVAILABLE' },
    );
  }

  private requireClient(): DeadlineAwareDiscoveryClient {
    if (this.discovery === undefined) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DISCOVERY_SERVICE_UNAVAILABLE',
        'Similar events are temporarily unavailable. Try again later.',
        { diagnosticCode: 'DISCOVERY_SIMILAR_CLIENT_UNAVAILABLE' },
      );
    }
    return this.discovery;
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }
}

function toEventDto(event: EventSearchResult): SearchEventResultDto {
  return {
    eventId: event.eventId,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
    categories: event.categories ?? [],
    venueName: event.venueName,
    venueCity: event.venueCity,
    venueCountryCode: event.venueCountryCode,
  };
}
