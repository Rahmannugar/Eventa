import { Module, type DynamicModule } from '@nestjs/common';

import type { RuntimeConfig } from '../config/runtime-config';
import { DatabaseModule } from '../database/database.module';
import { StripePaymentProviderAdapter } from './adapters/stripe-payment-provider.adapter';
import { PaymentAttemptRepository } from './repositories/payment-attempt.repository';
import { PaymentAttemptService } from './services/payment-attempt.service';
import {
  PAYMENT_ATTEMPT_REPOSITORY,
  PAYMENT_MANAGEMENT,
  PAYMENT_PROVIDER_PORT,
} from './payments.tokens';
import type { PaymentAttemptRepository as PaymentAttemptRepositoryContract } from './types/payment-attempt.types';
import type { PaymentProviderPort } from './types/payment-provider.port';

export function registerPaymentsModule(config: RuntimeConfig): DynamicModule {
  return {
    module: PaymentsModule,
    imports: [DatabaseModule],
    providers: [
      PaymentAttemptRepository,
      {
        provide: PAYMENT_ATTEMPT_REPOSITORY,
        useExisting: PaymentAttemptRepository,
      },
      {
        provide: PAYMENT_PROVIDER_PORT,
        useFactory: () =>
          new StripePaymentProviderAdapter({
            maxNetworkRetries: config.stripeMaxNetworkRetries,
            secretKey: config.stripeSecretKey,
            timeoutMs: config.stripeTimeoutMs,
          }),
      },
      {
        provide: PAYMENT_MANAGEMENT,
        inject: [PAYMENT_ATTEMPT_REPOSITORY, PAYMENT_PROVIDER_PORT],
        useFactory: (
          attempts: PaymentAttemptRepositoryContract,
          provider: PaymentProviderPort,
        ) => new PaymentAttemptService(attempts, provider),
      },
    ],
    exports: [PAYMENT_MANAGEMENT],
  };
}

@Module({})
export class PaymentsModule {}
