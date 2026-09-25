import { Module, type DynamicModule } from '@nestjs/common';

import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { DatabaseModule } from '../database/database.module';
import { KafkaClient } from '../infrastructure/clients/kafka.client';
import { OrdersModule } from '../orders/orders.module';
import { OrderRepository } from '../orders/repositories/order.repository';
import { registerPaymentsModule } from '../payments/payments.module';
import { PaymentAttemptRepository } from '../payments/repositories/payment-attempt.repository';
import { PAYMENT_PROVIDER_PORT } from '../payments/payments.tokens';
import type { PaymentProviderPort } from '../payments/types/payment-provider.port';
import { EventCancelledConsumer } from './consumers/event-cancelled.consumer';
import { CancelledEventRefundRepository } from './repositories/cancelled-event-refund.repository';
import { EventCancellationRefundService } from './services/event-cancellation-refund.service';
import { CancelledEventRefundWorker } from './services/cancelled-event-refund.worker';
import { CANCELLED_EVENT_REFUND_CLAIM } from './cancelled-event-refunds.tokens';

export function registerCancelledEventRefundsModule(config: RuntimeConfig) {
  return {
    module: CancelledEventRefundsModule,
    imports: [DatabaseModule, OrdersModule, registerPaymentsModule(config)],
    providers: [
      {
        provide: KafkaClient,
        inject: [RUNTIME_CONFIG],
        useFactory: (runtime: RuntimeConfig) =>
          new KafkaClient({
            brokers: runtime.kafkaBrokers,
            clientId: 'eventa-commerce-service',
            consumerGroup: runtime.kafkaConsumerGroup,
          }),
      },
      CancelledEventRefundRepository,
      EventCancellationRefundService,
      {
        provide: CANCELLED_EVENT_REFUND_CLAIM,
        useExisting: EventCancellationRefundService,
      },
      {
        provide: EventCancelledConsumer,
        inject: [KafkaClient, EventCancellationRefundService, RUNTIME_CONFIG],
        useFactory: (
          kafka: KafkaClient,
          refunds: EventCancellationRefundService,
          runtime: RuntimeConfig,
        ) =>
          new EventCancelledConsumer(
            kafka,
            refunds,
            runtime.kafkaEventLifecycleTopic,
          ),
      },
      {
        provide: CancelledEventRefundWorker,
        inject: [
          PaymentAttemptRepository,
          OrderRepository,
          PAYMENT_PROVIDER_PORT,
        ],
        useFactory: (
          payments: PaymentAttemptRepository,
          orders: OrderRepository,
          provider: PaymentProviderPort,
        ) => new CancelledEventRefundWorker(payments, orders, provider),
      },
    ],
    exports: [CANCELLED_EVENT_REFUND_CLAIM],
  } satisfies DynamicModule;
}

@Module({})
export class CancelledEventRefundsModule {}
