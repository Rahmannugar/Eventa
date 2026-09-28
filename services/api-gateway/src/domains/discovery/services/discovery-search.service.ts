import {
  DISCOVERY_SERVICE_NAME,
  type EventSearchResult,
  type SearchEventsRequest,
  type SearchEventsResponse,
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
  SearchEventResultDto,
  SearchEventsDto,
  SearchEventsQueryDto,
} from '../dto/discovery-search.dto';
import type { DeadlineAwareDiscoveryClient } from '../types/discovery-grpc-client.types';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class DiscoverySearchService implements OnModuleInit {
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

  async search(query: SearchEventsQueryDto, requestId: string): Promise<SearchEventsDto> {
    const request: SearchEventsRequest = {
      query: query.query ?? '',
      categories: query.categories ?? [],
      startsFrom: query.startsFrom,
      startsTo: query.startsTo,
      limit: query.limit,
      offset: query.offset,
    };

    try {
      const response = await firstValueFrom(
        this.requireClient().searchEvents(
          request,
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      return this.toDto(response);
    } catch (error: unknown) {
      if (error instanceof ApiHttpException) throw error;
      if (errorCode(error) === status.INVALID_ARGUMENT) {
        throw new ApiHttpException(
          HttpStatus.BAD_REQUEST,
          'SEARCH_QUERY_INVALID',
          'Search could not be understood.',
        );
      }
      if (errorCode(error) === status.DEADLINE_EXCEEDED) {
        throw this.unavailable('DISCOVERY_SEARCH_RPC_DEADLINE_EXCEEDED');
      }
      throw this.unavailable('DISCOVERY_SEARCH_RPC_UNAVAILABLE');
    }
  }

  // toDto re-reads the response rather than trusting it: a result without an
  // identity or a title is not something the client can render.
  private toDto(response: SearchEventsResponse): SearchEventsDto {
    const events = (response.events ?? []).map((event) =>
      this.toResult(event),
    );
    return {
      events,
      total: response.total ?? 0,
      limit: response.limit ?? 0,
      offset: response.offset ?? 0,
    };
  }

  private toResult(event: EventSearchResult): SearchEventResultDto {
    if (!event.eventId || !event.title) {
      throw this.unavailable('DISCOVERY_SEARCH_RESPONSE_INVALID');
    }
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

  private requireClient(): DeadlineAwareDiscoveryClient {
    if (this.discovery === undefined) {
      throw this.unavailable('DISCOVERY_SEARCH_CLIENT_UNAVAILABLE');
    }
    return this.discovery;
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'DISCOVERY_SERVICE_UNAVAILABLE',
      'Search is temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
