import {
  MiddlewareConsumer,
  Module,
  type DynamicModule,
  type NestModule,
} from '@nestjs/common';
import {
  HttpRequestTelemetryMiddleware,
  TelemetryLifecycleService,
} from '@eventa/observability';

import type { RuntimeConfig } from './config/runtime-config';
import { RuntimeConfigModule } from './config/runtime-config.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({})
export class AppModule implements NestModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeConfigModule.register(config),
        NotificationsModule,
        HealthModule,
      ],
      providers: [HttpRequestTelemetryMiddleware, TelemetryLifecycleService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpRequestTelemetryMiddleware).forRoutes('*');
  }
}
