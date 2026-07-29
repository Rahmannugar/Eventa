import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentAdminAccountDto } from '../dto/current-admin-account.dto';
import { AdminAuthenticationGuard } from '../guards/admin-authentication.guard';
import { AdminClientOriginGuard } from '../guards/admin-client-origin.guard';
import {
  AdminAccountRateLimitGuard,
  AdminLogoutRateLimitGuard,
} from '../rate-limit/admin-session-rate-limit';
import {
  AdminSessionCookie,
  type AdminSessionCookieResponse,
} from '../services/admin-session-cookie.service';
import { AdminSessionService } from '../services/admin-session.service';
import { RequestId } from '../../../http/request-id.decorator';
import type { AdminAuthenticatedRequest } from '../types/authenticated-admin.types';

interface SessionRequest {
  headers: { cookie?: string };
}

@ApiTags('Admin authentication')
@Controller('auth/admins')
export class AdminSessionController {
  constructor(
    private readonly adminSessions: AdminSessionService,
    private readonly sessionCookie: AdminSessionCookie,
  ) {}

  @Get('me')
  @UseGuards(
    AdminClientOriginGuard,
    AdminAccountRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiCookieAuth('adminSession')
  @ApiOperation({ summary: 'Get the signed-in admin account' })
  @ApiResponse({ status: HttpStatus.OK, type: CurrentAdminAccountDto })
  account(
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<CurrentAdminAccountDto> {
    return this.adminSessions.getCurrentAccount(
      request.adminSession.adminId,
      requestId,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminClientOriginGuard, AdminLogoutRateLimitGuard)
  @ApiOperation({ summary: 'Sign out the current admin session' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  async logout(
    @Req() request: SessionRequest,
    @RequestId() requestId: string,
    @Res({ passthrough: true }) response: AdminSessionCookieResponse,
  ): Promise<void> {
    const token = this.sessionCookie.read(request.headers.cookie);

    if (token !== undefined) {
      await this.adminSessions.logout(token, requestId);
    }

    this.sessionCookie.clear(response);
  }
}
