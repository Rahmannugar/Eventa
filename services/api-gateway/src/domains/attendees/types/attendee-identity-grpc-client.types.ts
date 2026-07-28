import type {
  AttendeeIdentityServiceClient,
  AuthenticateAttendeeSessionRequest,
  AuthenticateAttendeeSessionResponse,
  ConfirmAttendeeEmailVerificationRequest,
  ConfirmAttendeeEmailVerificationResponse,
  ForgotAttendeePasswordRequest,
  ForgotAttendeePasswordResponse,
  LoginAttendeeRequest,
  LoginAttendeeResponse,
  GetCurrentAttendeeAccountRequest,
  GetCurrentAttendeeAccountResponse,
  LogoutAttendeeRequest,
  LogoutAttendeeResponse,
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
  ResendAttendeeEmailVerificationRequest,
  ResendAttendeeEmailVerificationResponse,
  ResetAttendeePasswordRequest,
  ResetAttendeePasswordResponse,
} from '@eventa/grpc-contracts';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export interface DeadlineAwareAttendeeIdentityServiceClient extends AttendeeIdentityServiceClient {
  authenticateAttendeeSession(
    request: AuthenticateAttendeeSessionRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<AuthenticateAttendeeSessionResponse>;
  getCurrentAttendeeAccount(
    request: GetCurrentAttendeeAccountRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<GetCurrentAttendeeAccountResponse>;
  logoutAttendee(
    request: LogoutAttendeeRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<LogoutAttendeeResponse>;
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
  forgotAttendeePassword(
    request: ForgotAttendeePasswordRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ForgotAttendeePasswordResponse>;
  resendAttendeeEmailVerification(
    request: ResendAttendeeEmailVerificationRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ResendAttendeeEmailVerificationResponse>;
  resetAttendeePassword(
    request: ResetAttendeePasswordRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ResetAttendeePasswordResponse>;
}
