import { z } from 'zod';

import { apiRequest } from '../api/api-client';
import type {
  AnalyticsEventListPage,
  AnalyticsListCriteria,
  PortfolioSummary,
} from './analytics.types';

const eventPerformanceSchema = z.object({
  eventId: z.uuid(),
  status: z.enum(['published', 'cancelled']),
  currency: z.string(),
  ticketsSold: z.number().int().nonnegative(),
  ticketsRefunded: z.number().int().nonnegative(),
  ticketsCheckedIn: z.number().int().nonnegative(),
  ticketsRevoked: z.number().int().nonnegative(),
  grossRevenueMinor: z.number().int().nonnegative(),
  refundedRevenueMinor: z.number().int().nonnegative(),
  netRevenueMinor: z.number().int(),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  cancelledAt: z.iso.datetime({ offset: true }).optional(),
  updatedAt: z.iso.datetime({ offset: true }),
});

const analyticsEventListPageSchema = z.object({
  events: z.array(eventPerformanceSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

const currencyTotalsSchema = z.object({
  currency: z.string().length(3),
  ticketsSold: z.number().int().nonnegative(),
  ticketsRefunded: z.number().int().nonnegative(),
  grossRevenueMinor: z.number().int().nonnegative(),
  refundedRevenueMinor: z.number().int().nonnegative(),
  netRevenueMinor: z.number().int(),
});

const portfolioSummarySchema = z.object({
  eventsPublished: z.number().int().nonnegative(),
  eventsCancelled: z.number().int().nonnegative(),
  ticketsCheckedIn: z.number().int().nonnegative(),
  ticketsRevoked: z.number().int().nonnegative(),
  revenue: z.array(currencyTotalsSchema),
});

export function listEventPerformance(
  criteria: AnalyticsListCriteria,
  signal?: AbortSignal,
): Promise<AnalyticsEventListPage> {
  const search = new URLSearchParams({
    limit: String(criteria.limit),
    offset: String(criteria.offset),
  });
  if (criteria.status !== '') search.set('status', criteria.status);
  return apiRequest<AnalyticsEventListPage>(
    `/admin/analytics/events?${search.toString()}`,
    {
      responseSchema: analyticsEventListPageSchema,
      ...(signal === undefined ? {} : { signal }),
    },
  );
}

export function getPortfolioSummary(
  signal?: AbortSignal,
): Promise<PortfolioSummary> {
  return apiRequest<PortfolioSummary>('/admin/analytics/summary', {
    responseSchema: portfolioSummarySchema,
    ...(signal === undefined ? {} : { signal }),
  });
}
