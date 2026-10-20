export type AnalyticsStatusFilter = '' | 'published' | 'cancelled';

export interface AnalyticsListCriteria {
  limit: number;
  offset: number;
  status: AnalyticsStatusFilter;
}

export interface EventPerformance {
  eventId: string;
  status: 'published' | 'cancelled';
  currency: string;
  ticketsSold: number;
  ticketsRefunded: number;
  ticketsCheckedIn: number;
  ticketsRevoked: number;
  grossRevenueMinor: number;
  refundedRevenueMinor: number;
  netRevenueMinor: number;
  publishedAt?: string | undefined;
  cancelledAt?: string | undefined;
  updatedAt: string;
}

export interface AnalyticsEventListPage {
  events: EventPerformance[];
  total: number;
  limit: number;
  offset: number;
}

export interface CurrencyTotals {
  currency: string;
  ticketsSold: number;
  ticketsRefunded: number;
  grossRevenueMinor: number;
  refundedRevenueMinor: number;
  netRevenueMinor: number;
}

export interface PortfolioSummary {
  eventsPublished: number;
  eventsCancelled: number;
  ticketsCheckedIn: number;
  ticketsRevoked: number;
  revenue: CurrencyTotals[];
}
