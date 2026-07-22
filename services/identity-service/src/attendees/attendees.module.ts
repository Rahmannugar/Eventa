import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SecurityModule } from '../security/security.module';
import {
  ATTENDEE_ACCOUNT_WRITER,
  REGISTER_ATTENDEE_HANDLER,
} from './constants/attendee-registration.constants';
import { RegisterAttendeeCommandHandler } from './commands/register-attendee/register-attendee-command.handler';
import { AttendeeRegistrationController } from './controllers/attendee-registration.controller';
import { ObservedRegisterAttendeeCommandHandler } from './observability/observed-register-attendee-command.handler';
import { AttendeeAccountWriteRepository } from './repositories/attendee-account-write.repository';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [AttendeeRegistrationController],
  providers: [
    RegisterAttendeeCommandHandler,
    {
      provide: REGISTER_ATTENDEE_HANDLER,
      useFactory: (commandHandler: RegisterAttendeeCommandHandler) =>
        new ObservedRegisterAttendeeCommandHandler(commandHandler),
      inject: [RegisterAttendeeCommandHandler],
    },
    {
      provide: ATTENDEE_ACCOUNT_WRITER,
      useClass: AttendeeAccountWriteRepository,
    },
  ],
})
export class AttendeesModule {}
