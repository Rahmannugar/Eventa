import type {
  CreateDraftEventRequest,
  CreateDraftEventResponse,
  GetAdminEventRequest,
  GetAdminEventResponse,
  UpdateDraftEventRequest,
  UpdateDraftEventResponse,
} from '@eventa/grpc-contracts';
import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

export interface DeadlineAwareEventServiceClient {
  createDraftEvent(
    request: CreateDraftEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<CreateDraftEventResponse>;
  getAdminEvent(
    request: GetAdminEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetAdminEventResponse>;
  updateDraftEvent(
    request: UpdateDraftEventRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<UpdateDraftEventResponse>;
}
