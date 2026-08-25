import { Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { DatabaseLifecycle } from './database-lifecycle';
import {
  COMMERCE_DATABASE,
  COMMERCE_POSTGRES_CLIENT,
} from './database.constants';

@Module({
  providers: [
    {
      provide: COMMERCE_POSTGRES_CLIENT,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        postgres(config.databaseUrl, {
          max: 10,
          onnotice: () => undefined,
        }),
    },
    {
      provide: COMMERCE_DATABASE,
      inject: [COMMERCE_POSTGRES_CLIENT],
      useFactory: (client: ReturnType<typeof postgres>) => drizzle(client),
    },
    DatabaseLifecycle,
  ],
  exports: [COMMERCE_DATABASE, COMMERCE_POSTGRES_CLIENT],
})
export class DatabaseModule {}
