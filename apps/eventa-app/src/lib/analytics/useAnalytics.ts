import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  getPortfolioSummary,
  listEventPerformance,
} from './analytics.service';
import type {
  AnalyticsListCriteria,
  AnalyticsEventListPage,
  PortfolioSummary,
} from './analytics.types';

export const analyticsSummaryQueryKey = ['analytics', 'summary'] as const;
export const analyticsListQueryKey = ['analytics', 'events'] as const;

export function useAnalyticsSummary() {
  return useQuery<PortfolioSummary, Error>({
    queryFn: ({ signal }) => getPortfolioSummary(signal),
    queryKey: analyticsSummaryQueryKey,
    retry: false,
  });
}

export function useEventPerformanceList(criteria: AnalyticsListCriteria) {
  return useQuery<AnalyticsEventListPage, Error>({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => listEventPerformance(criteria, signal),
    queryKey: [...analyticsListQueryKey, criteria] as const,
    retry: false,
  });
}
