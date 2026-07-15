import { Global, Module, type DynamicModule } from '@nestjs/common';

import { RUNTIME_CONFIG } from './runtime.constants';
import type { RuntimeConfig } from './runtime-config';

@Global()
@Module({})
export class RuntimeConfigModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: RuntimeConfigModule,
      providers: [
        {
          provide: RUNTIME_CONFIG,
          useValue: config,
        },
      ],
      exports: [RUNTIME_CONFIG],
    };
  }
}
