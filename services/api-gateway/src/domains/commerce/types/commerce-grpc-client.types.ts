import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';
import type {
  StartTicketPurchaseRequest,
  GetCommerceOrderRequest,
  StartTicketPurchaseResponse,
  GetCommerceOrderResponse,
} from '@eventa/grpc-contracts';

export interface DeadlineAwareCommerceClient {
  startTicketPurchase(
    request: StartTicketPurchaseRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<StartTicketPurchaseResponse>;
  getCommerceOrder(
    request: GetCommerceOrderRequest,
    metadata: Metadata,
    options: CallOptions,
  ): Observable<GetCommerceOrderResponse>;
}
