import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { LoggedInAdminDto, LoginAdminDto } from '../dto/login-admin.dto';
import { AdminClientOriginGuard } from '../guards/admin-client-origin.guard';
import { AdminLoginRateLimitGuard } from '../rate-limit/admin-login-rate-limit';
import { AdminLoginService } from '../services/admin-login.service';
import {
  AdminSessionCookie,
  type AdminSessionCookieResponse,
} from '../services/admin-session-cookie.service';

@ApiTags('Admin authentication')
@Controller('auth/admins')
export class AdminLoginController {
  constructor(
    private readonly adminLogin: AdminLoginService,
    private readonly sessionCookie: AdminSessionCookie,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminClientOriginGuard, AdminLoginRateLimitGuard)
  @ApiOperation({ summary: 'Sign in an activated admin' })
  @ApiResponse({ status: HttpStatus.OK, type: LoggedInAdminDto })
  async login(
    @Body() request: LoginAdminDto,
    @Headers('x-request-id') requestId: string,
    @Res({ passthrough: true }) response: AdminSessionCookieResponse,
  ): Promise<LoggedInAdminDto> {
    const result = await this.adminLogin.login(
      request.email,
      request.password,
      requestId,
    );
    this.sessionCookie.set(
      response,
      result.sessionToken,
      result.sessionExpiresAt,
    );
    return { adminId: result.adminId, email: result.email };
  }
}
