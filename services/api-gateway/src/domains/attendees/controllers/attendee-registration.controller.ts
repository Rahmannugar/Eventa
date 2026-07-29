import type { RegisterAttendeeResponse } from '@eventa/grpc-contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AttendeeRegistrationService } from '../services/attendee-registration.service';
import { RequestId } from '../../../http/request-id.decorator';
import { ApiRegisterAttendee } from '../docs/attendee-registration.docs';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import { AttendeeRegistrationRateLimitGuard } from '../rate-limit/guards/attendee-registration-rate-limit.guard';

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeeRegistrationController {
  constructor(
    private readonly attendeeRegistration: AttendeeRegistrationService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AttendeeRegistrationRateLimitGuard)
  @ApiRegisterAttendee()
  register(
    @Body() request: RegisterAttendeeDto,
    @RequestId() requestId: string,
  ): Promise<RegisterAttendeeResponse> {
    return this.attendeeRegistration.register({
      email: request.email,
      password: request.password,
      requestId,
      username: request.username,
    });
  }
}
