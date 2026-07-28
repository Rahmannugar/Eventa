import { Module, type DynamicModule } from '@nestjs/common';
import {
  EVENTA_IDENTITY_V1_PACKAGE_NAME,
  getIdentityProtoIncludeDirs,
  getIdentityProtoPaths,
} from '@eventa/grpc-contracts';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { RATE_LIMIT_STATE } from '../../rate-limit/constants/rate-limit.constants';
import type { RateLimitState } from '../../rate-limit/ports/rate-limit.state';
import {
  ADMIN_CLIENT_ORIGIN,
  ADMIN_IDENTITY_GRPC_CLIENT,
  ADMIN_IDENTITY_GRPC_DEADLINE_MS,
} from './constants/admin-registration.constants';
import { AdminActivationController } from './controllers/admin-activation.controller';
import { AdminClientOriginGuard } from './guards/admin-client-origin.guard';
import {
  AdminRegistrationRateLimitGuard,
  AdminRegistrationRateLimitService,
} from './rate-limit/admin-registration-rate-limit';
import {
  AdminActivationCompleteRateLimitGuard,
  AdminActivationConfirmRateLimitGuard,
  AdminActivationRateLimitService,
} from './rate-limit/admin-activation-rate-limit';
import { AdminActivationCookie } from './services/admin-activation-cookie.service';
import { AdminActivationService } from './services/admin-activation.service';

interface AdminsModuleOptions {
  adminClientOrigin: string;
  identityGrpcDeadlineMs: number;
  identityGrpcUrl: string;
  rateLimitKeySecret: string;
  secureActivationCookie: boolean;
}

@Module({})
export class AdminsModule {
  static register(options: AdminsModuleOptions): DynamicModule {
    return {
      module: AdminsModule,
      imports: [
        ClientsModule.register([
          {
            name: ADMIN_IDENTITY_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_IDENTITY_V1_PACKAGE_NAME,
              protoPath: getIdentityProtoPaths(),
              loader: { includeDirs: getIdentityProtoIncludeDirs() },
              url: options.identityGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [AdminActivationController],
      providers: [
        {
          provide: ADMIN_CLIENT_ORIGIN,
          useValue: options.adminClientOrigin,
        },
        {
          provide: ADMIN_IDENTITY_GRPC_DEADLINE_MS,
          useValue: options.identityGrpcDeadlineMs,
        },
        AdminActivationService,
        {
          provide: AdminActivationCookie,
          useFactory: () =>
            new AdminActivationCookie(options.secureActivationCookie),
        },
        {
          provide: AdminActivationRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminActivationRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AdminRegistrationRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminRegistrationRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        AdminClientOriginGuard,
        AdminActivationConfirmRateLimitGuard,
        AdminActivationCompleteRateLimitGuard,
        AdminRegistrationRateLimitGuard,
      ],
    };
  }
}
