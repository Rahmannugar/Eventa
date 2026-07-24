import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [HealthController],
})
export class HealthModule {}
