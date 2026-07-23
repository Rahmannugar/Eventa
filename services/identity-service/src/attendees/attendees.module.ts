import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SecurityModule } from '../security/security.module';
import {
  ATTENDEE_ACCOUNT_REPOSITORY,
  ATTENDEE_REGISTRAR,
} from './constants/attendee-registration.constants';
import { AttendeeRegistrationService } from './services/attendee-registration.service';
import { AttendeeRegistrationController } from './controllers/attendee-registration.controller';
import { ObservedAttendeeRegistrar } from './observability/observed-attendee-registrar';
import { PostgresAttendeeAccountRepository } from './repositories/attendee-account.repository';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [AttendeeRegistrationController],
  providers: [
    AttendeeRegistrationService,
    {
      provide: ATTENDEE_REGISTRAR,
      useFactory: (registration: AttendeeRegistrationService) =>
        new ObservedAttendeeRegistrar(registration),
      inject: [AttendeeRegistrationService],
    },
    {
      provide: ATTENDEE_ACCOUNT_REPOSITORY,
      useClass: PostgresAttendeeAccountRepository,
    },
  ],
})
export class AttendeesModule {}
