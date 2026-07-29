import type {
  AdminIdentityServiceClient,
  ActivateAdminRequest,
  ActivateAdminResponse,
  AuthenticateAdminSessionRequest,
  AuthenticateAdminSessionResponse,
  GetCurrentAdminAccountRequest,
  GetCurrentAdminAccountResponse,
  ForgotAdminPasswordRequest,
  ForgotAdminPasswordResponse,
  LoginAdminRequest,
  LoginAdminResponse,
  LogoutAdminRequest,
  LogoutAdminResponse,
  ResetAdminPasswordRequest,
  ResetAdminPasswordResponse,
  RegisterAdminRequest,
  RegisterAdminResponse,
} from '@eventa/grpc-contracts';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export interface DeadlineAwareAdminIdentityServiceClient extends AdminIdentityServiceClient {
  registerAdmin(
    request: RegisterAdminRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<RegisterAdminResponse>;
  activateAdmin(
    request: ActivateAdminRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ActivateAdminResponse>;
  loginAdmin(
    request: LoginAdminRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<LoginAdminResponse>;
  authenticateAdminSession(
    request: AuthenticateAdminSessionRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<AuthenticateAdminSessionResponse>;
  getCurrentAdminAccount(
    request: GetCurrentAdminAccountRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<GetCurrentAdminAccountResponse>;
  logoutAdmin(
    request: LogoutAdminRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<LogoutAdminResponse>;
  forgotAdminPassword(
    request: ForgotAdminPasswordRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ForgotAdminPasswordResponse>;
  resetAdminPassword(
    request: ResetAdminPasswordRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ResetAdminPasswordResponse>;
}
