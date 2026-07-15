import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { RegisterAttendeeResponse } from '@eventa/grpc-contracts';
import { ApiTags } from '@nestjs/swagger';

import { AttendeeRegistrationRateLimitGuard } from '../../rate-limit/guards/attendee-registration-rate-limit.guard';
import { DocumentAttendeeRegistration } from '../docs/attendee-registration.docs';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
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
  @DocumentAttendeeRegistration()
  register(
    @Body() request: RegisterAttendeeDto,
  ): Promise<RegisterAttendeeResponse> {
    return this.attendeeRegistrationService.register(request);
  }
}
