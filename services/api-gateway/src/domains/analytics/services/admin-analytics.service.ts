import {
  ANALYTICS_SERVICE_NAME,
  type CurrencyTotals,
  type EventPerformance,
  type GetPortfolioSummaryResponse,
  type ListEventPerformanceResponse,
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
  ANALYTICS_GRPC_CLIENT,
  ANALYTICS_GRPC_DEADLINE_MS,
} from '../constants/analytics.constants';
import type {
  AnalyticsEventDto,
  AnalyticsEventListDto,
  AnalyticsListQueryDto,
  EventPerformanceDto,
  PortfolioSummaryDto,
} from '../dto/analytics.dto';
import type { DeadlineAwareAnalyticsClient } from '../types/analytics-grpc-client.types';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class AdminAnalyticsService implements OnModuleInit {
  private analytics?: DeadlineAwareAnalyticsClient;

  constructor(
    @Inject(ANALYTICS_GRPC_CLIENT) private readonly grpcClient: ClientGrpc,
    @Inject(ANALYTICS_GRPC_DEADLINE_MS) private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.analytics = this.grpcClient.getService<DeadlineAwareAnalyticsClient>(
      ANALYTICS_SERVICE_NAME,
    );
  }

  async list(
    query: AnalyticsListQueryDto,
    requestId: string,
  ): Promise<AnalyticsEventListDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().listEventPerformance(
          { limit: query.limit, offset: query.offset, status: query.status ?? '' },
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      return this.toList(response);
    } catch (error: unknown) {
      throw this.translate(error, 'ANALYTICS_LIST');
    }
  }

  async get(
    eventId: string,
    requestId: string,
  ): Promise<AnalyticsEventDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().getEventPerformance(
          { eventId },
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      const event = response.event;
      if (!isPerformance(event) || event.eventId !== eventId) {
        throw this.unavailable('ANALYTICS_GET_RESPONSE_INVALID');
      }
      return { event: toPerformanceDto(event) };
    } catch (error: unknown) {
      throw this.translate(error, 'ANALYTICS_GET');
    }
  }

  async summary(requestId: string): Promise<PortfolioSummaryDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().getPortfolioSummary(
          {},
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      return this.toSummary(response);
    } catch (error: unknown) {
      throw this.translate(error, 'ANALYTICS_SUMMARY');
    }
  }

  // toList re-reads the response rather than trusting it: an answer whose
  // shape does not match this caller's request is not safe to return.
  private toList(response: ListEventPerformanceResponse): AnalyticsEventListDto {
    if (
      !Array.isArray(response.events) ||
      !Number.isInteger(response.total) ||
      !Number.isInteger(response.limit) ||
      !Number.isInteger(response.offset) ||
      !response.events.every(isPerformance)
    ) {
      throw this.unavailable('ANALYTICS_LIST_RESPONSE_INVALID');
    }
    return {
      events: response.events.map(toPerformanceDto),
      total: response.total,
      limit: response.limit,
      offset: response.offset,
    };
  }

  private toSummary(response: GetPortfolioSummaryResponse): PortfolioSummaryDto {
    if (
      !Number.isInteger(response.eventsPublished) ||
      !Number.isInteger(response.eventsCancelled) ||
      typeof response.ticketsCheckedIn !== 'number' ||
      typeof response.ticketsRevoked !== 'number' ||
      !Array.isArray(response.revenue) ||
      !response.revenue.every(isCurrencyTotals)
    ) {
      throw this.unavailable('ANALYTICS_SUMMARY_RESPONSE_INVALID');
    }
    return {
      eventsPublished: response.eventsPublished,
      eventsCancelled: response.eventsCancelled,
      ticketsCheckedIn: response.ticketsCheckedIn,
      ticketsRevoked: response.ticketsRevoked,
      revenue: response.revenue.map((row) => ({
        currency: row.currency,
        ticketsSold: row.ticketsSold,
        ticketsRefunded: row.ticketsRefunded,
        grossRevenueMinor: row.grossRevenueMinor,
        refundedRevenueMinor: row.refundedRevenueMinor,
        netRevenueMinor: row.netRevenueMinor,
      })),
    };
  }

  private translate(error: unknown, diagnosticStage: string): unknown {
    if (error instanceof ApiHttpException) return error;
    if (errorCode(error) === status.NOT_FOUND) {
      return new ApiHttpException(
        HttpStatus.NOT_FOUND,
        'EVENT_PERFORMANCE_NOT_FOUND',
        'That event has no performance data yet.',
      );
    }
    if (errorCode(error) === status.INVALID_ARGUMENT) {
      return new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        'ANALYTICS_QUERY_INVALID',
        'Those analytics could not be loaded.',
      );
    }
    if (errorCode(error) === status.DEADLINE_EXCEEDED) {
      return this.unavailable(`${diagnosticStage}_RPC_DEADLINE_EXCEEDED`);
    }
    return this.unavailable(`${diagnosticStage}_RPC_UNAVAILABLE`);
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ANALYTICS_SERVICE_UNAVAILABLE',
      'Analytics are temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }

  private requireClient(): DeadlineAwareAnalyticsClient {
    if (this.analytics === undefined) {
      throw this.unavailable('ANALYTICS_CLIENT_UNAVAILABLE');
    }
    return this.analytics;
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }
}

function isPerformance(value: unknown): value is EventPerformance {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.eventId === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.currency === 'string' &&
    typeof candidate.ticketsSold === 'number' &&
    typeof candidate.ticketsRefunded === 'number' &&
    typeof candidate.ticketsCheckedIn === 'number' &&
    typeof candidate.ticketsRevoked === 'number' &&
    typeof candidate.grossRevenueMinor === 'number' &&
    typeof candidate.refundedRevenueMinor === 'number' &&
    typeof candidate.netRevenueMinor === 'number' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isCurrencyTotals(value: unknown): value is CurrencyTotals {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.currency === 'string' &&
    typeof candidate.ticketsSold === 'number' &&
    typeof candidate.ticketsRefunded === 'number' &&
    typeof candidate.grossRevenueMinor === 'number' &&
    typeof candidate.refundedRevenueMinor === 'number' &&
    typeof candidate.netRevenueMinor === 'number'
  );
}

function toPerformanceDto(row: EventPerformance): EventPerformanceDto {
  return {
    eventId: row.eventId,
    status: row.status,
    currency: row.currency,
    ticketsSold: row.ticketsSold,
    ticketsRefunded: row.ticketsRefunded,
    ticketsCheckedIn: row.ticketsCheckedIn,
    ticketsRevoked: row.ticketsRevoked,
    grossRevenueMinor: row.grossRevenueMinor,
    refundedRevenueMinor: row.refundedRevenueMinor,
    netRevenueMinor: row.netRevenueMinor,
    ...(row.publishedAt === undefined ? {} : { publishedAt: row.publishedAt }),
    ...(row.cancelledAt === undefined ? {} : { cancelledAt: row.cancelledAt }),
    updatedAt: row.updatedAt,
  };
}
