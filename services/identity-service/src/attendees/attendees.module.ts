import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SecurityModule } from '../security/security.module';
import { ATTENDEE_REGISTRATION_STORE } from './constants/attendee-registration.constants';
import { AttendeeRegistrationController } from './controllers/attendee-registration.controller';
import { AttendeeRegistrationRepository } from './repositories/attendee-registration.repository';
import { RegisterAttendeeService } from './services/register-attendee.service';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [AttendeeRegistrationController],
  providers: [
    RegisterAttendeeService,
    {
      provide: ATTENDEE_REGISTRATION_STORE,
      useClass: AttendeeRegistrationRepository,
    },
  ],
})
export class AttendeesModule {}
