import {
  MiddlewareConsumer,
  Module,
  type DynamicModule,
  type NestModule,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  HttpRequestTelemetryMiddleware,
  RpcRequestTelemetryInterceptor,
  TelemetryLifecycleService,
} from '@eventa/observability';

import type { RuntimeConfig } from './config/runtime-config';
import { RuntimeConfigModule } from './config/runtime-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OrdersModule } from './orders/orders.module';
import { registerTicketPurchaseModule } from './ticket-purchase/ticket-purchase.module';

@Module({})
export class AppModule implements NestModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeConfigModule.register(config),
        DatabaseModule,
        HealthModule,
        OrdersModule,
        registerTicketPurchaseModule(config),
      ],
      providers: [
        HttpRequestTelemetryMiddleware,
        TelemetryLifecycleService,
        {
          provide: APP_INTERCEPTOR,
          useClass: RpcRequestTelemetryInterceptor,
        },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpRequestTelemetryMiddleware).forRoutes('*');
  }
}
