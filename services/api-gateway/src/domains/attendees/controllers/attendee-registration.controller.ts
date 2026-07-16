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

import { ApiRegisterAttendee } from '../docs/attendee-registration.docs';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import { AttendeeRegistrationRateLimitGuard } from '../rate-limit/guards/attendee-registration-rate-limit.guard';
import { AttendeeRegistrationService } from '../services/attendee-registration.service';

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeeRegistrationController {
  constructor(
    private readonly attendeeRegistrationService: AttendeeRegistrationService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AttendeeRegistrationRateLimitGuard)
  @ApiRegisterAttendee()
  register(
    @Body() request: RegisterAttendeeDto,
  ): Promise<RegisterAttendeeResponse> {
    return this.attendeeRegistrationService.register(request);
  }
}
