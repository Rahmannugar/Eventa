import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { POSTGRES_CLIENT } from './database.constants';
import type { PostgresClient } from './database.types';

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly client: PostgresClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.end();
  }
}
