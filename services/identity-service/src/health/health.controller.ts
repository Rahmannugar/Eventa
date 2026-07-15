import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';

import { POSTGRES_CLIENT } from '../database/database.constants';
import type { PostgresClient } from '../database/database.types';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(POSTGRES_CLIENT)
    private readonly databaseClient: PostgresClient,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    try {
      await this.databaseClient`select 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
  }
}
