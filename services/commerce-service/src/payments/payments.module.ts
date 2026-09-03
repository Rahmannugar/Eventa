import { Module, type DynamicModule } from '@nestjs/common';

import type { RuntimeConfig } from '../config/runtime-config';
import { DatabaseModule } from '../database/database.module';
import { StripePaymentProviderAdapter } from './adapters/stripe-payment-provider.adapter';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { ObservedPaymentProviderEventHandling } from './observability/observed-payment-provider-event-handling';
import { PaymentAttemptRepository } from './repositories/payment-attempt.repository';
import { PaymentAttemptService } from './services/payment-attempt.service';
import { PaymentProviderEventService } from './services/payment-provider-event.service';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';
import {
  PAYMENT_ATTEMPT_REPOSITORY,
  PAYMENT_MANAGEMENT,
  PAYMENT_PROVIDER_EVENT_HANDLING,
  PAYMENT_PROVIDER_PORT,
  PAYMENT_WEBHOOK_VERIFIER,
} from './payments.tokens';
import type { PaymentAttemptRepository as PaymentAttemptRepositoryContract } from './types/payment-attempt.types';
import type {
  PaymentProviderPort,
  PaymentWebhookVerifier,
} from './types/payment-provider.port';

export function registerPaymentsModule(config: RuntimeConfig): DynamicModule {
  return {
    module: PaymentsModule,
    imports: [DatabaseModule],
    controllers: [StripeWebhookController],
    providers: [
      PaymentAttemptRepository,
      {
        provide: PAYMENT_ATTEMPT_REPOSITORY,
        useExisting: PaymentAttemptRepository,
      },
      {
        provide: StripePaymentProviderAdapter,
        useFactory: () =>
          new StripePaymentProviderAdapter({
            maxNetworkRetries: config.stripeMaxNetworkRetries,
            secretKey: config.stripeSecretKey,
            timeoutMs: config.stripeTimeoutMs,
            webhookSecret: config.stripeWebhookSecret,
          }),
      },
      {
        provide: PAYMENT_PROVIDER_PORT,
        useExisting: StripePaymentProviderAdapter,
      },
      {
        provide: PAYMENT_WEBHOOK_VERIFIER,
        useExisting: StripePaymentProviderAdapter,
      },
      {
        provide: PAYMENT_MANAGEMENT,
        inject: [PAYMENT_ATTEMPT_REPOSITORY, PAYMENT_PROVIDER_PORT],
        useFactory: (
          attempts: PaymentAttemptRepositoryContract,
          provider: PaymentProviderPort,
        ) => new PaymentAttemptService(attempts, provider),
      },
      {
        provide: PAYMENT_PROVIDER_EVENT_HANDLING,
        inject: [
          PAYMENT_ATTEMPT_REPOSITORY,
          PAYMENT_PROVIDER_PORT,
          PAYMENT_WEBHOOK_VERIFIER,
        ],
        useFactory: (
          attempts: PaymentAttemptRepositoryContract,
          provider: PaymentProviderPort,
          verifier: PaymentWebhookVerifier,
        ) =>
          new ObservedPaymentProviderEventHandling(
            new PaymentProviderEventService(attempts, provider, verifier),
          ),
      },
      {
        provide: PaymentReconciliationService,
        inject: [PAYMENT_ATTEMPT_REPOSITORY, PAYMENT_PROVIDER_PORT],
        useFactory: (
          attempts: PaymentAttemptRepositoryContract,
          provider: PaymentProviderPort,
        ) => new PaymentReconciliationService(attempts, provider),
      },
    ],
    exports: [PAYMENT_MANAGEMENT, PAYMENT_PROVIDER_PORT, PaymentAttemptRepository],
  };
}

@Module({})
export class PaymentsModule {}
