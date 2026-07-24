import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { RuntimeConfig } from './runtime-config';
import { RUNTIME_CONFIG } from './runtime.constants';

@Global()
@Module({})
export class RuntimeConfigModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: RuntimeConfigModule,
      providers: [{ provide: RUNTIME_CONFIG, useValue: config }],
      exports: [RUNTIME_CONFIG],
    };
  }
}
