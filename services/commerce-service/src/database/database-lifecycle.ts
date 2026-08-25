import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { COMMERCE_POSTGRES_CLIENT } from './database.constants';
import type { PostgresClient } from './database.types';

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(COMMERCE_POSTGRES_CLIENT) private readonly client: PostgresClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.end();
  }
}
