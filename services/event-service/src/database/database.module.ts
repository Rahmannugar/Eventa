import { Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { RUNTIME_CONFIG } from '../config/runtime.constants';
import type { RuntimeConfig } from '../config/runtime-config';
import { EVENT_DATABASE, POSTGRES_CLIENT } from './database.constants';
import { DatabaseLifecycle } from './database-lifecycle';

@Module({
  providers: [
    {
      provide: POSTGRES_CLIENT,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        postgres(config.databaseUrl, { max: 10, onnotice: () => undefined }),
    },
    {
      provide: EVENT_DATABASE,
      inject: [POSTGRES_CLIENT],
      useFactory: (client: ReturnType<typeof postgres>) => drizzle(client),
    },
    DatabaseLifecycle,
  ],
  exports: [EVENT_DATABASE, POSTGRES_CLIENT],
})
export class DatabaseModule {}
