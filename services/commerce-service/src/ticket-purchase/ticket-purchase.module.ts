import { Module } from '@nestjs/common';
import {
  ClientsModule,
  Transport,
  type ClientGrpc,
} from '@nestjs/microservices';
import {
  EVENTA_EVENT_V1_PACKAGE_NAME,
  getEventProtoIncludeDirs,
  getEventProtoPaths,
} from '@eventa/grpc-contracts';

import type { RuntimeConfig } from '../config/runtime-config';
import { OrdersModule } from '../orders/orders.module';
import { OrderRepository } from '../orders/repositories/order.repository';
import { registerPaymentsModule } from '../payments/payments.module';
import { PaymentAttemptRepository } from '../payments/repositories/payment-attempt.repository';
import { PAYMENT_MANAGEMENT, PAYMENT_PROVIDER_PORT } from '../payments/payments.tokens';
import type { PaymentManagement } from '../payments/types/payment-attempt.types';
import type { PaymentProviderPort } from '../payments/types/payment-provider.port';
import { EventGrpcCapacityAdapter } from './adapters/event-grpc-capacity.adapter';
import { ObservedTicketPurchaseManagement } from './observability/observed-ticket-purchase-management';
import { EVENT_GRPC_CLIENT } from './ticket-purchase.constants';
import {
  EVENT_CAPACITY_PORT,
  TICKET_PURCHASE_MANAGEMENT,
} from './ticket-purchase.tokens';
import { TicketPurchaseService } from './services/ticket-purchase.service';
import { TicketPurchaseCompletionService } from './services/ticket-purchase-completion.service';
import { TicketPurchaseExpiryService } from './services/ticket-purchase-expiry.service';
import { TicketPurchaseController } from './controllers/ticket-purchase.controller';
import type { EventCapacityPort } from './types/event-capacity.port';

export function registerTicketPurchaseModule(config: RuntimeConfig) {
  return {
    module: TicketPurchaseModule,
    imports: [
      OrdersModule,
      registerPaymentsModule(config),
      ClientsModule.register([
        {
          name: EVENT_GRPC_CLIENT,
          transport: Transport.GRPC,
          options: {
            package: EVENTA_EVENT_V1_PACKAGE_NAME,
            protoPath: getEventProtoPaths(),
            loader: { arrays: true, includeDirs: getEventProtoIncludeDirs() },
            url: config.eventGrpcUrl,
          },
        },
      ]),
    ],
    providers: [
      {
        provide: EventGrpcCapacityAdapter,
        inject: [EVENT_GRPC_CLIENT],
        useFactory: (client: ClientGrpc) =>
          new EventGrpcCapacityAdapter(client, config.eventGrpcDeadlineMs),
      },
      { provide: EVENT_CAPACITY_PORT, useExisting: EventGrpcCapacityAdapter },
      {
        provide: TicketPurchaseCompletionService,
        inject: [OrderRepository, EVENT_CAPACITY_PORT, PaymentAttemptRepository, PAYMENT_PROVIDER_PORT],
        useFactory: (
          orders: OrderRepository,
          capacity: EventCapacityPort,
          outcomes: PaymentAttemptRepository,
          provider: PaymentProviderPort,
        ) => new TicketPurchaseCompletionService(outcomes, orders, capacity, provider),
      },
      {
        provide: TicketPurchaseExpiryService,
        inject: [OrderRepository, PaymentAttemptRepository, PAYMENT_PROVIDER_PORT, EVENT_CAPACITY_PORT],
        useFactory: (
          orders: OrderRepository,
          payments: PaymentAttemptRepository,
          provider: PaymentProviderPort,
          capacity: EventCapacityPort,
        ) => new TicketPurchaseExpiryService(orders, payments, provider, capacity),
      },
      {
        provide: TICKET_PURCHASE_MANAGEMENT,
        inject: [OrderRepository, EVENT_CAPACITY_PORT, PAYMENT_MANAGEMENT],
        useFactory: (
          orders: OrderRepository,
          capacity: EventCapacityPort,
          payments: PaymentManagement,
        ) =>
          new ObservedTicketPurchaseManagement(
            new TicketPurchaseService(orders, capacity, payments),
          ),
      },
    ],
    controllers: [TicketPurchaseController],
    exports: [TICKET_PURCHASE_MANAGEMENT],
  };
}

@Module({})
export class TicketPurchaseModule {}
