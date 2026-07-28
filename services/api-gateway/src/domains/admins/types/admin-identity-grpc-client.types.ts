import type {
  AdminIdentityServiceClient,
  CompleteAdminActivationRequest,
  CompleteAdminActivationResponse,
  ConfirmAdminActivationRequest,
  ConfirmAdminActivationResponse,
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
  confirmAdminActivation(
    request: ConfirmAdminActivationRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<ConfirmAdminActivationResponse>;
  completeAdminActivation(
    request: CompleteAdminActivationRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<CompleteAdminActivationResponse>;
}
