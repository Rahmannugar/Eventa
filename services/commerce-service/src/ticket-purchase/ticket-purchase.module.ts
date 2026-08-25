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
import { EventGrpcCapacityAdapter } from './adapters/event-grpc-capacity.adapter';
import { EVENT_GRPC_CLIENT } from './ticket-purchase.constants';
import { EVENT_CAPACITY_PORT } from './ticket-purchase.tokens';
import { TicketPurchaseService } from './services/ticket-purchase.service';
import { TicketPurchaseController } from './controllers/ticket-purchase.controller';

export function registerTicketPurchaseModule(config: RuntimeConfig) {
  return {
    module: TicketPurchaseModule,
    imports: [
      OrdersModule,
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
      TicketPurchaseService,
    ],
    controllers: [TicketPurchaseController],
    exports: [TicketPurchaseService],
  };
}

@Module({})
export class TicketPurchaseModule {}
