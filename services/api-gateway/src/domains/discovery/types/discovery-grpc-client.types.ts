import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';
import type {
  GetAttendeeInterestsRequest,
  GetAttendeeInterestsResponse,
  SearchEventsRequest,
  SearchEventsResponse,
  SetAttendeeInterestsRequest,
  SetAttendeeInterestsResponse,
} from '@eventa/grpc-contracts';

export interface DeadlineAwareDiscoveryClient {
  searchEvents(
    request: SearchEventsRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<SearchEventsResponse>;

  getAttendeeInterests(
    request: GetAttendeeInterestsRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetAttendeeInterestsResponse>;

  setAttendeeInterests(
    request: SetAttendeeInterestsRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<SetAttendeeInterestsResponse>;
}
