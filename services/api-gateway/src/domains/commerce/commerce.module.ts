import { type DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  getCommerceProtoIncludeDirs,
  getCommerceProtoPaths,
  EVENTA_COMMERCE_V1_PACKAGE_NAME,
} from '@eventa/grpc-contracts';
import {
  COMMERCE_GRPC_CLIENT,
  COMMERCE_GRPC_DEADLINE_MS,
} from './constants/commerce.constants';
import { CommerceOrderController } from './controllers/commerce-order.controller';
import { CommerceOrderService } from './services/commerce-order.service';
import type { RateLimitState } from '../../rate-limit/ports/rate-limit.state';
import { RATE_LIMIT_STATE } from '../../rate-limit/constants/rate-limit.constants';
import {
  CommerceOrderRateLimitGuard,
  CommerceOrderRateLimitService,
} from './rate-limit/commerce-order-rate-limit';
export class CommerceModule {
  static register(options: {
    attendeesModule: DynamicModule;
    commerceGrpcUrl: string;
    commerceGrpcDeadlineMs: number;
    rateLimitKeySecret: string;
  }): DynamicModule {
    return {
      module: CommerceModule,
      imports: [
        options.attendeesModule,
        ClientsModule.register([
          {
            name: COMMERCE_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_COMMERCE_V1_PACKAGE_NAME,
              protoPath: getCommerceProtoPaths(),
              loader: {
                arrays: true,
                includeDirs: getCommerceProtoIncludeDirs(),
              },
              url: options.commerceGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [CommerceOrderController],
      providers: [
        {
          provide: COMMERCE_GRPC_DEADLINE_MS,
          useValue: options.commerceGrpcDeadlineMs,
        },
        {
          provide: CommerceOrderRateLimitService,
          inject: [RATE_LIMIT_STATE],
          useFactory: (state: RateLimitState) =>
            new CommerceOrderRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
        },
        CommerceOrderRateLimitGuard,
        CommerceOrderService,
      ],
    };
  }
}
