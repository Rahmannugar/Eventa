import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  ApiForgotAttendeePassword,
  ApiResetAttendeePassword,
} from '../docs/attendee-password-reset.docs';
import {
  ForgotAttendeePasswordDto,
  type ForgotAttendeePasswordResponseDto,
  ResetAttendeePasswordDto,
  type ResetAttendeePasswordResponseDto,
} from '../dto/attendee-password-reset.dto';
import { AttendeeClientOriginGuard } from '../guards/attendee-client-origin.guard';
import {
  AttendeeForgotPasswordRateLimitGuard,
  AttendeeResetPasswordRateLimitGuard,
} from '../rate-limit/guards/attendee-password-reset-rate-limit.guards';
import { AttendeePasswordResetService } from '../services/attendee-password-reset.service';
import { RequestId } from '../../../http/request-id.decorator';

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeePasswordResetController {
  constructor(private readonly passwordReset: AttendeePasswordResetService) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AttendeeClientOriginGuard, AttendeeForgotPasswordRateLimitGuard)
  @ApiForgotAttendeePassword()
  forgotPassword(
    @Body() request: ForgotAttendeePasswordDto,
    @RequestId() requestId: string,
  ): Promise<ForgotAttendeePasswordResponseDto> {
    return this.passwordReset.forgotPassword({
      email: request.email,
      requestId,
    });
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AttendeeClientOriginGuard, AttendeeResetPasswordRateLimitGuard)
  @ApiResetAttendeePassword()
  resetPassword(
    @Body() request: ResetAttendeePasswordDto,
    @RequestId() requestId: string,
  ): Promise<ResetAttendeePasswordResponseDto> {
    return this.passwordReset.resetPassword({
      code: request.code,
      email: request.email,
      newPassword: request.newPassword,
      requestId,
    });
  }
}
