import { Module, type DynamicModule } from '@nestjs/common';

import type { RuntimeConfig } from './config/runtime-config';
import { RuntimeConfigModule } from './config/runtime-config.module';
import { AttendeesModule } from './attendees/attendees.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeConfigModule.register(config),
        AttendeesModule,
        HealthModule,
      ],
    };
  }
}
