import type {
  AttendeeIdentityServiceClient,
  ConfirmAttendeeEmailVerificationRequest,
  ConfirmAttendeeEmailVerificationResponse,
  LoginAttendeeRequest,
  LoginAttendeeResponse,
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
  ResendAttendeeEmailVerificationRequest,
  ResendAttendeeEmailVerificationResponse,
} from '@eventa/grpc-contracts';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export interface DeadlineAwareAttendeeIdentityServiceClient extends AttendeeIdentityServiceClient {
  loginAttendee(
    request: LoginAttendeeRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<LoginAttendeeResponse>;
  registerAttendee(
    request: RegisterAttendeeRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<RegisterAttendeeResponse>;
  confirmAttendeeEmailVerification(
    request: ConfirmAttendeeEmailVerificationRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ConfirmAttendeeEmailVerificationResponse>;
  resendAttendeeEmailVerification(
    request: ResendAttendeeEmailVerificationRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ResendAttendeeEmailVerificationResponse>;
}
