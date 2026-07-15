import { Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { DatabaseLifecycle } from './database-lifecycle';
import { IDENTITY_DATABASE, POSTGRES_CLIENT } from './database.constants';

@Module({
  providers: [
    {
      provide: POSTGRES_CLIENT,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        postgres(config.databaseUrl, {
          max: 10,
          onnotice: () => undefined,
        }),
    },
    {
      provide: IDENTITY_DATABASE,
      inject: [POSTGRES_CLIENT],
      useFactory: (client: ReturnType<typeof postgres>) => drizzle(client),
    },
    DatabaseLifecycle,
  ],
  exports: [IDENTITY_DATABASE, POSTGRES_CLIENT],
})
export class DatabaseModule {}
