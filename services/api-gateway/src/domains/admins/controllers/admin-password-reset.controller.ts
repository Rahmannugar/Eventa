import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  ForgotAdminPasswordDto,
  ForgotAdminPasswordResponseDto,
  ResetAdminPasswordDto,
  ResetAdminPasswordResponseDto,
} from '../dto/admin-password-reset.dto';
import { AdminClientOriginGuard } from '../guards/admin-client-origin.guard';
import {
  AdminForgotPasswordRateLimitGuard,
  AdminResetPasswordRateLimitGuard,
} from '../rate-limit/admin-password-reset-rate-limit';
import { AdminPasswordResetService } from '../services/admin-password-reset.service';

@ApiTags('Admin authentication')
@Controller('auth/admins')
export class AdminPasswordResetController {
  constructor(private readonly passwordReset: AdminPasswordResetService) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AdminClientOriginGuard, AdminForgotPasswordRateLimitGuard)
  @ApiOperation({ summary: 'Request an admin password reset code' })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    type: ForgotAdminPasswordResponseDto,
  })
  forgotPassword(
    @Body() request: ForgotAdminPasswordDto,
    @Headers('x-request-id') requestId: string,
  ): Promise<ForgotAdminPasswordResponseDto> {
    return this.passwordReset.forgotPassword(request.email, requestId);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminClientOriginGuard, AdminResetPasswordRateLimitGuard)
  @ApiOperation({ summary: 'Reset an admin password' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: ResetAdminPasswordResponseDto,
  })
  resetPassword(
    @Body() request: ResetAdminPasswordDto,
    @Headers('x-request-id') requestId: string,
  ): Promise<ResetAdminPasswordResponseDto> {
    return this.passwordReset.resetPassword(
      request.email,
      request.code,
      request.newPassword,
      requestId,
    );
  }
}
