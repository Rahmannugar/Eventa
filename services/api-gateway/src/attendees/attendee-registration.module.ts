import { Module, type DynamicModule } from '@nestjs/common';
import {
  getIdentityProtoPath,
  IDENTITY_PACKAGE_NAME,
} from '@eventa/grpc-contracts';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { IDENTITY_GRPC_CLIENT } from './constants/attendee-registration.constants';
import { AttendeeRegistrationController } from './controllers/attendee-registration.controller';
import { AttendeeRegistrationService } from './services/attendee-registration.service';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

interface AttendeeRegistrationModuleOptions {
  identityGrpcUrl: string;
  rateLimitKeySecret: string;
  redisUrl: string;
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
        RateLimitModule.register({
          keySecret: options.rateLimitKeySecret,
          redisUrl: options.redisUrl,
        }),
      ],
      controllers: [AttendeeRegistrationController],
      providers: [AttendeeRegistrationService],
    };
  }
}
