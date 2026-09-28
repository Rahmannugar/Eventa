import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';
import type {
  SearchEventsRequest,
  SearchEventsResponse,
} from '@eventa/grpc-contracts';

export interface DeadlineAwareDiscoveryClient {
  searchEvents(
    request: SearchEventsRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<SearchEventsResponse>;
}
