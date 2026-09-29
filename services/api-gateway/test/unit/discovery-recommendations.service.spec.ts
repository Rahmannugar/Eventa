import type {
  RecommendEventsRequest,
  RecommendEventsResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ApiHttpException } from '../../src/http/errors/api-http.exception';
import type { RecommendEventsQueryDto } from '../../src/domains/discovery/dto/discovery-recommendations.dto';
import { DiscoveryRecommendationsService } from '../../src/domains/discovery/services/discovery-recommendations.service';
import type { DeadlineAwareDiscoveryClient } from '../../src/domains/discovery/types/discovery-grpc-client.types';

const attendeeId = '1d29185a-ba65-491f-8bd8-1cbc54b85630';
const query: RecommendEventsQueryDto = { limit: 5 };

const ranked: RecommendEventsResponse = {
  attendeeId,
  events: [
    {
      eventId: '8882dcda-b687-4689-9671-5643969c13af',
      title: 'Lagos Street Food Festival',
      description: 'Tastings from forty vendors.',
      startsAt: '2026-11-14T10:00:00Z',
      endsAt: '2026-11-14T18:00:00Z',
      timeZone: 'Africa/Lagos',
      categories: ['food'],
      venueName: 'Tafawa Balewa Square',
      venueCity: 'Lagos',
      venueCountryCode: 'NG',
    },
  ],
};

function createService(
  methods: Partial<DeadlineAwareDiscoveryClient>,
  deadlineMs = 3_000,
): DiscoveryRecommendationsService {
  const grpcClient = {
    getService: () => methods,
  } as unknown as ClientGrpc;
  const service = new DiscoveryRecommendationsService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('DiscoveryRecommendationsService', () => {
  it('forwards the attendee id, limit, and correlation id, and returns the ranked events', async () => {
    let receivedRequest: RecommendEventsRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;

    const service = createService({
      recommendEvents: (
        request: RecommendEventsRequest,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<RecommendEventsResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of(ranked);
      },
    });

    await expect(
      service.recommend(attendeeId, query, 'request-123'),
    ).resolves.toEqual({ events: ranked.events });
    expect(receivedRequest).toEqual({ attendeeId, limit: 5 });
    expect(receivedMetadata?.get('x-request-id')).toEqual(['request-123']);
    expect(receivedOptions?.deadline).toBeInstanceOf(Date);
  });

  it('refuses to return recommendations recorded for a different attendee', async () => {
    const service = createService({
      recommendEvents: (): Observable<RecommendEventsResponse> =>
        of({
          ...ranked,
          attendeeId: '2d3a295b-0b76-4e00-a0cf-2dc65cb96741',
        }),
    });

    await expect(
      service.recommend(attendeeId, query, 'request-123'),
    ).rejects.toMatchObject({
      diagnosticCode: 'DISCOVERY_RECOMMENDATIONS_RESPONSE_INVALID',
      response: {
        code: 'DISCOVERY_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });

  it('reports a request Discovery rejected as invalid', async () => {
    const service = createService({
      recommendEvents: () =>
        throwError(() => ({ code: status.INVALID_ARGUMENT })),
    });

    await expect(
      service.recommend(attendeeId, query, 'request-123'),
    ).rejects.toMatchObject({
      response: {
        code: 'RECOMMENDATIONS_INVALID',
        statusCode: 400,
      },
    });
  });

  it('reports a missed deadline as an unavailable answer', async () => {
    const service = createService({
      recommendEvents: () =>
        throwError(() => ({ code: status.DEADLINE_EXCEEDED })),
    });

    await expect(
      service.recommend(attendeeId, query, 'request-123'),
    ).rejects.toMatchObject({
      diagnosticCode: 'DISCOVERY_RECOMMENDATIONS_RPC_DEADLINE_EXCEEDED',
      response: {
        code: 'DISCOVERY_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });

  it('does not claim an exception was produced by Discovery when it never reached it', async () => {
    const service = createService({});

    await expect(
      service.recommend(attendeeId, query, 'request-123'),
    ).rejects.toBeInstanceOf(ApiHttpException);
  });
});
