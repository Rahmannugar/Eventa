import { Module, type DynamicModule } from '@nestjs/common';
import {
  getIdentityProtoPath,
  IDENTITY_PACKAGE_NAME,
} from '@eventa/grpc-contracts';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { RATE_LIMIT_STORE } from '../../rate-limit/constants/rate-limit.constants';
import type { RateLimitStore } from '../../rate-limit/types/rate-limit.types';
import { IDENTITY_GRPC_CLIENT } from './constants/attendee-registration.constants';
import { AttendeeRegistrationController } from './controllers/attendee-registration.controller';
import { AttendeeRegistrationRateLimitGuard } from './rate-limit/guards/attendee-registration-rate-limit.guard';
import { AttendeeRegistrationRateLimitService } from './rate-limit/services/attendee-registration-rate-limit.service';
import { AttendeeRegistrationService } from './services/attendee-registration.service';

interface AttendeeRegistrationModuleOptions {
  identityGrpcUrl: string;
  rateLimitKeySecret: string;
}

@Module({})
export class AttendeeRegistrationModule {
  static register(options: AttendeeRegistrationModuleOptions): DynamicModule {
    return {
      module: AttendeeRegistrationModule,
      imports: [
        ClientsModule.register([
          {
            name: IDENTITY_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: IDENTITY_PACKAGE_NAME,
              protoPath: getIdentityProtoPath(),
              url: options.identityGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [AttendeeRegistrationController],
      providers: [
        AttendeeRegistrationService,
        {
          provide: AttendeeRegistrationRateLimitService,
          useFactory: (store: RateLimitStore) =>
            new AttendeeRegistrationRateLimitService(
              store,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STORE],
        },
        AttendeeRegistrationRateLimitGuard,
      ],
    };
  }
}
