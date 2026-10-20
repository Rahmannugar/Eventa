import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';
import type {
  GetEventPerformanceRequest,
  GetEventPerformanceResponse,
  GetPortfolioSummaryRequest,
  GetPortfolioSummaryResponse,
  ListEventPerformanceRequest,
  ListEventPerformanceResponse,
} from '@eventa/grpc-contracts';

export interface DeadlineAwareAnalyticsClient {
  listEventPerformance(
    request: ListEventPerformanceRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<ListEventPerformanceResponse>;

  getEventPerformance(
    request: GetEventPerformanceRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetEventPerformanceResponse>;

  getPortfolioSummary(
    request: GetPortfolioSummaryRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetPortfolioSummaryResponse>;
}
