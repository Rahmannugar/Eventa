import type {
  EventPerformance,
  GetPortfolioSummaryResponse,
  ListEventPerformanceResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ApiHttpException } from '../../src/http/errors/api-http.exception';
import type { AnalyticsListQueryDto } from '../../src/domains/analytics/dto/analytics.dto';
import { AdminAnalyticsService } from '../../src/domains/analytics/services/admin-analytics.service';
import type { DeadlineAwareAnalyticsClient } from '../../src/domains/analytics/types/analytics-grpc-client.types';

const eventId = '8882dcda-b687-4689-9671-5643969c13af';
const query: AnalyticsListQueryDto = { limit: 25, offset: 0 };

const performance: EventPerformance = {
  eventId,
  status: 'published',
  currency: 'USD',
  ticketsSold: 3,
  ticketsRefunded: 1,
  ticketsCheckedIn: 2,
  ticketsRevoked: 0,
  grossRevenueMinor: 15000,
  refundedRevenueMinor: 5000,
  netRevenueMinor: 10000,
  publishedAt: '2026-10-01T09:00:00Z',
  cancelledAt: undefined,
  updatedAt: '2026-10-20T10:00:00Z',
};

const summary: GetPortfolioSummaryResponse = {
  eventsPublished: 1,
  eventsCancelled: 0,
  ticketsCheckedIn: 2,
  ticketsRevoked: 0,
  revenue: [
    {
      currency: 'USD',
      ticketsSold: 3,
      ticketsRefunded: 1,
      grossRevenueMinor: 15000,
      refundedRevenueMinor: 5000,
      netRevenueMinor: 10000,
    },
  ],
};

function createService(
  methods: Partial<DeadlineAwareAnalyticsClient>,
  deadlineMs = 3_000,
): AdminAnalyticsService {
  const grpcClient = {
    getService: () => methods,
  } as unknown as ClientGrpc;
  const service = new AdminAnalyticsService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('AdminAnalyticsService', () => {
  it('forwards the page query and correlation id, and returns the mapped rows', async () => {
    let receivedRequest: unknown;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;

    const response: ListEventPerformanceResponse = {
      events: [performance],
      total: 1,
      limit: 25,
      offset: 0,
    };
    const service = createService({
      listEventPerformance: (
        request: unknown,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<ListEventPerformanceResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of(response);
      },
    });

    await expect(service.list(query, 'request-123')).resolves.toEqual({
      events: [
        {
          eventId,
          status: 'published',
          currency: 'USD',
          ticketsSold: 3,
          ticketsRefunded: 1,
          ticketsCheckedIn: 2,
          ticketsRevoked: 0,
          grossRevenueMinor: 15000,
          refundedRevenueMinor: 5000,
          netRevenueMinor: 10000,
          publishedAt: '2026-10-01T09:00:00Z',
          updatedAt: '2026-10-20T10:00:00Z',
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
    expect(receivedRequest).toEqual({ limit: 25, offset: 0, status: '' });
    expect(receivedMetadata?.get('x-request-id')).toEqual(['request-123']);
    expect(receivedOptions?.deadline).toBeInstanceOf(Date);
  });

  it('refuses to return a list whose events are not an array', async () => {
    const service = createService({
      listEventPerformance: (): Observable<ListEventPerformanceResponse> =>
        of({
          events: undefined,
          total: 1,
          limit: 25,
          offset: 0,
        } as unknown as ListEventPerformanceResponse),
    });

    await expect(service.list(query, 'request-123')).rejects.toMatchObject({
      diagnosticCode: 'ANALYTICS_LIST_RESPONSE_INVALID',
      response: {
        code: 'ANALYTICS_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });

  it('refuses to return a single event recorded for a different event id', async () => {
    const service = createService({
      getEventPerformance: (): Observable<{ event: EventPerformance }> =>
        of({ event: { ...performance, eventId: 'different' } }),
    });

    await expect(service.get(eventId, 'request-123')).rejects.toMatchObject({
      diagnosticCode: 'ANALYTICS_GET_RESPONSE_INVALID',
      response: {
        code: 'ANALYTICS_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });

  it('maps an unknown event to 404', async () => {
    const service = createService({
      getEventPerformance: (): Observable<never> =>
        throwError(() => ({ code: status.NOT_FOUND })),
    });

    await expect(service.get(eventId, 'request-123')).rejects.toMatchObject({
      response: {
        code: 'EVENT_PERFORMANCE_NOT_FOUND',
        statusCode: 404,
      },
    });
  });

  it('maps a malformed query to 400', async () => {
    const service = createService({
      listEventPerformance: (): Observable<never> =>
        throwError(() => ({ code: status.INVALID_ARGUMENT })),
    });

    await expect(service.list(query, 'request-123')).rejects.toMatchObject({
      response: {
        code: 'ANALYTICS_QUERY_INVALID',
        statusCode: 400,
      },
    });
  });

  it('maps an expired deadline to an unavailable answer with a diagnostic code', async () => {
    const service = createService({
      getPortfolioSummary: (): Observable<never> =>
        throwError(() => ({ code: status.DEADLINE_EXCEEDED })),
    });

    await expect(service.summary('request-123')).rejects.toMatchObject({
      diagnosticCode: 'ANALYTICS_SUMMARY_RPC_DEADLINE_EXCEEDED',
      response: {
        code: 'ANALYTICS_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });

  it('maps any other failure to an unavailable answer', async () => {
    const service = createService({
      getPortfolioSummary: (): Observable<never> =>
        throwError(() => new Error('connection refused')),
    });

    await expect(service.summary('request-123')).rejects.toBeInstanceOf(
      ApiHttpException,
    );
  });

  it('maps the portfolio summary per currency', async () => {
    const service = createService({
      getPortfolioSummary: (): Observable<GetPortfolioSummaryResponse> =>
        of(summary),
    });

    await expect(service.summary('request-123')).resolves.toEqual({
      eventsPublished: 1,
      eventsCancelled: 0,
      ticketsCheckedIn: 2,
      ticketsRevoked: 0,
      revenue: [
        {
          currency: 'USD',
          ticketsSold: 3,
          ticketsRefunded: 1,
          grossRevenueMinor: 15000,
          refundedRevenueMinor: 5000,
          netRevenueMinor: 10000,
        },
      ],
    });
  });
});
