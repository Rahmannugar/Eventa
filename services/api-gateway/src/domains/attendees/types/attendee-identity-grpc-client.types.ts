import type {
  AttendeeIdentityServiceClient,
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export interface DeadlineAwareAttendeeIdentityServiceClient extends AttendeeIdentityServiceClient {
  registerAttendee(
    request: RegisterAttendeeRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<RegisterAttendeeResponse>;
}
