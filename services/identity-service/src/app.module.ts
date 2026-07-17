import {
  MiddlewareConsumer,
  Module,
  type DynamicModule,
  type NestModule,
} from '@nestjs/common';
import {
  HttpRequestTelemetryMiddleware,
  RpcRequestTelemetryInterceptor,
  TelemetryLifecycleService,
} from '@eventa/observability';
import { APP_INTERCEPTOR } from '@nestjs/core';

import type { RuntimeConfig } from './config/runtime-config';
import { RuntimeConfigModule } from './config/runtime-config.module';
import { AttendeesModule } from './attendees/attendees.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule implements NestModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeConfigModule.register(config),
        AttendeesModule,
        HealthModule,
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
