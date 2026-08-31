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
import { PAYMENT_MANAGEMENT } from '../payments/payments.tokens';
import type { PaymentManagement } from '../payments/types/payment-attempt.types';
import { EventGrpcCapacityAdapter } from './adapters/event-grpc-capacity.adapter';
import { ObservedTicketPurchaseManagement } from './observability/observed-ticket-purchase-management';
import { EVENT_GRPC_CLIENT } from './ticket-purchase.constants';
import {
  EVENT_CAPACITY_PORT,
  TICKET_PURCHASE_MANAGEMENT,
} from './ticket-purchase.tokens';
import { TicketPurchaseService } from './services/ticket-purchase.service';
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
