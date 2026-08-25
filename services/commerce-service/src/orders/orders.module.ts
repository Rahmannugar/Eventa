import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OrderRepository } from './repositories/order.repository';

@Module({
  imports: [DatabaseModule],
  providers: [OrderRepository],
  exports: [OrderRepository],
})
export class OrdersModule {}
