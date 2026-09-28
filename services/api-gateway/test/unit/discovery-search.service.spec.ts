import {
  type EventSearchResult,
  type SearchEventsRequest,
  type SearchEventsResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DiscoverySearchService } from '../../src/domains/discovery/services/discovery-search.service';
import type { SearchEventsQueryDto } from '../../src/domains/discovery/dto/discovery-search.dto';
import type { DeadlineAwareDiscoveryClient } from '../../src/domains/discovery/types/discovery-grpc-client.types';

const result: EventSearchResult = {
  categories: ['Music'],
  description: 'A waterfront Afrobeats bill.',
  endsAt: '2026-11-21T22:30:00Z',
  eventId: '1d29185a-ba65-491f-8bd8-1cbc54b85630',
  startsAt: '2026-11-21T18:00:00Z',
  timeZone: 'Africa/Lagos',
  title: 'Afrobeats Live: Waterfront Sessions',
  venueCity: 'Lagos',
  venueCountryCode: 'NG',
  venueName: 'Eko Atlantic Convention Centre',
};

const query: SearchEventsQueryDto = {
  categories: ['music'],
  limit: 20,
  offset: 0,
  query: 'afrobeats',
};

function createService(
  searchEvents: DeadlineAwareDiscoveryClient['searchEvents'],
  deadlineMs = 3_000,
): DiscoverySearchService {
  const grpcClient = {
    getService: () => ({ searchEvents }),
  } as unknown as ClientGrpc;
  const service = new DiscoverySearchService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('DiscoverySearchService', () => {
  it('forwards the query and correlation id, and returns the search shape', async () => {
    let receivedRequest: SearchEventsRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;

    const service = createService(
      (
        request: SearchEventsRequest,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<SearchEventsResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of({
          events: [result],
          limit: 20,
          offset: 0,
          total: 1,
        });
      },
    );

    const response = await service.search(query, 'request-123');

    expect(receivedRequest).toEqual({
      categories: ['music'],
      limit: 20,
      offset: 0,
      query: 'afrobeats',
    });
    expect(receivedMetadata?.get('x-request-id')).toEqual(['request-123']);
    expect(receivedOptions?.deadline).toBeInstanceOf(Date);
    expect(response).toEqual({
      events: [
        {
          categories: ['Music'],
          description: 'A waterfront Afrobeats bill.',
          endsAt: '2026-11-21T22:30:00Z',
          eventId: '1d29185a-ba65-491f-8bd8-1cbc54b85630',
          startsAt: '2026-11-21T18:00:00Z',
          timeZone: 'Africa/Lagos',
          title: 'Afrobeats Live: Waterfront Sessions',
          venueCity: 'Lagos',
          venueCountryCode: 'NG',
          venueName: 'Eko Atlantic Convention Centre',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
  });

  it('reports a rejected query as a client error', async () => {
    const service = createService(() =>
      throwError(() => ({ code: status.INVALID_ARGUMENT })),
    );

    await expect(service.search(query, 'request-123')).rejects.toMatchObject({
      response: {
        code: 'SEARCH_QUERY_INVALID',
        statusCode: 400,
      },
      status: 400,
    });
  });

  it('reports a missed deadline as unavailable with its diagnostic code', async () => {
    const service = createService(() =>
      throwError(() => ({ code: status.DEADLINE_EXCEEDED })),
    );

    await expect(service.search(query, 'request-123')).rejects.toMatchObject({
      diagnosticCode: 'DISCOVERY_SEARCH_RPC_DEADLINE_EXCEEDED',
      response: {
        code: 'DISCOVERY_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
      status: 503,
    });
  });

  it('refuses a result the client could not render', async () => {
    // A result without a title cannot be rendered, so the service must
    // reject it even though it violates the message contract.
    const malformed = {
      events: [{ eventId: '1d29185a-ba65-491f-8bd8-1cbc54b85630' }],
      limit: 20,
      offset: 0,
      total: 1,
    } as unknown as SearchEventsResponse;
    const service = createService(() => of(malformed));

    await expect(service.search(query, 'request-123')).rejects.toMatchObject({
      diagnosticCode: 'DISCOVERY_SEARCH_RESPONSE_INVALID',
      response: {
        code: 'DISCOVERY_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });
});
