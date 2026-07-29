import {
  AdminIdentityServiceControllerMethods,
  type ActivateAdminResponse,
  type AuthenticateAdminSessionResponse,
  type GetCurrentAdminAccountResponse,
  type ForgotAdminPasswordResponse,
  type LoginAdminResponse,
  type LogoutAdminResponse,
  type ResetAdminPasswordResponse,
  type AdminIdentityServiceController,
  type RegisterAdminResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { from, type Observable } from 'rxjs';

import { RegisterAdminDto } from '../dto/register-admin.dto';
import { LoginAdminDto } from '../dto/login-admin.dto';
import { ActivateAdminDto } from '../dto/admin-activation.dto';
import {
  AdminActivationOtpInvalidError,
  AdminActivationRateLimitedError,
  AdminActivationStateUnavailableError,
} from '../errors/admin-activation.errors';
import { AdminActivationService } from '../services/admin-activation.service';
import { InvalidAdminCredentialsError } from '../errors/admin-login.errors';
import { AdminSessionStateUnavailableError } from '../errors/admin-session.errors';
import { InvalidAdminSessionError } from '../errors/admin-session.errors';
import { AdminLoginService } from '../services/admin-login.service';
import {
  AuthenticateAdminSessionDto,
  GetCurrentAdminAccountDto,
  LogoutAdminDto,
} from '../dto/admin-session.dto';
import { AdminSessionService } from '../services/admin-session.service';
import { AdminAccountService } from '../services/admin-account.service';
import {
  ForgotAdminPasswordDto,
  ResetAdminPasswordDto,
} from '../dto/admin-password-reset.dto';
import {
  AdminPasswordResetCodeInvalidError,
  AdminPasswordResetRateLimitedError,
} from '../errors/admin-password-reset.errors';
import { PasswordResetStateUnavailableError } from '../../security/errors/password-reset.errors';
import { AdminPasswordResetService } from '../services/admin-password-reset.service';

@Controller()
@AdminIdentityServiceControllerMethods()
export class AdminIdentityController implements AdminIdentityServiceController {
  constructor(
    private readonly adminActivation: AdminActivationService,
    private readonly adminLogin: AdminLoginService,
    private readonly adminSessions: AdminSessionService,
    private readonly adminAccounts: AdminAccountService,
    private readonly adminPasswordReset: AdminPasswordResetService,
  ) {}

  registerAdmin(request: RegisterAdminDto): Observable<RegisterAdminResponse> {
    return from(this.handleRegistration(request.email));
  }

  activateAdmin(request: ActivateAdminDto): Observable<ActivateAdminResponse> {
    return from(this.handleActivation(request));
  }

  loginAdmin(request: LoginAdminDto): Observable<LoginAdminResponse> {
    return from(this.handleLogin(request));
  }

  authenticateAdminSession(
    request: AuthenticateAdminSessionDto,
  ): Observable<AuthenticateAdminSessionResponse> {
    return from(this.handleSessionAuthentication(request.sessionToken));
  }

  getCurrentAdminAccount(
    request: GetCurrentAdminAccountDto,
  ): Observable<GetCurrentAdminAccountResponse> {
    return from(this.handleCurrentAccount(request.adminId));
  }

  logoutAdmin(request: LogoutAdminDto): Observable<LogoutAdminResponse> {
    return from(this.handleLogout(request.sessionToken));
  }

  forgotAdminPassword(
    request: ForgotAdminPasswordDto,
  ): Observable<ForgotAdminPasswordResponse> {
    return from(this.handleForgotPassword(request.email));
  }

  resetAdminPassword(
    request: ResetAdminPasswordDto,
  ): Observable<ResetAdminPasswordResponse> {
    return from(
      this.handleResetPassword(
        request.email,
        request.code,
        request.newPassword,
      ),
    );
  }

  private async handleRegistration(
    email: string,
  ): Promise<RegisterAdminResponse> {
    try {
      return await this.adminActivation.register(email);
    } catch (error: unknown) {
      if (error instanceof AdminActivationRateLimitedError) {
        const metadata = new Metadata();
        metadata.set('retry-after', String(error.retryAfterSeconds));
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: error.message,
          metadata,
        });
      }

      if (error instanceof AdminActivationStateUnavailableError) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private async handleActivation(
    request: ActivateAdminDto,
  ): Promise<ActivateAdminResponse> {
    try {
      return await this.adminActivation.activate(
        request.email,
        request.otp,
        request.password,
      );
    } catch (error: unknown) {
      this.translateActivationError(error);
    }
  }

  private translateActivationError(error: unknown): never {
    if (error instanceof AdminActivationOtpInvalidError) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: error.message,
      });
    }

    if (error instanceof AdminActivationStateUnavailableError) {
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: error.message,
      });
    }

    throw error;
  }

  private async handleLogin(
    request: LoginAdminDto,
  ): Promise<LoginAdminResponse> {
    try {
      return await this.adminLogin.login(request.email, request.password);
    } catch (error: unknown) {
      if (error instanceof InvalidAdminCredentialsError) {
        throw new RpcException({
          code: status.UNAUTHENTICATED,
          message: error.message,
        });
      }

      if (error instanceof AdminSessionStateUnavailableError) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private async handleSessionAuthentication(
    token: string,
  ): Promise<AuthenticateAdminSessionResponse> {
    try {
      const session = await this.adminSessions.require(token);
      return {
        adminId: session.adminId,
        sessionExpiresAt: session.expiresAt.toISOString(),
        sessionId: session.sessionId,
      };
    } catch (error: unknown) {
      this.translateSessionError(error);
    }
  }

  private async handleCurrentAccount(
    adminId: string,
  ): Promise<GetCurrentAdminAccountResponse> {
    try {
      return await this.adminAccounts.getCurrentAccount(adminId);
    } catch (error: unknown) {
      this.translateSessionError(error);
    }
  }

  private async handleLogout(token: string): Promise<LogoutAdminResponse> {
    try {
      return { revoked: await this.adminSessions.revoke(token) };
    } catch (error: unknown) {
      this.translateSessionError(error);
    }
  }

  private translateSessionError(error: unknown): never {
    if (error instanceof InvalidAdminSessionError) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: error.message,
      });
    }

    if (error instanceof AdminSessionStateUnavailableError) {
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: error.message,
      });
    }

    throw error;
  }

  private async handleForgotPassword(
    email: string,
  ): Promise<ForgotAdminPasswordResponse> {
    try {
      return await this.adminPasswordReset.forgotPassword(email);
    } catch (error: unknown) {
      if (error instanceof AdminPasswordResetRateLimitedError) {
        const metadata = new Metadata();
        metadata.set('retry-after', String(error.retryAfterSeconds));
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: error.message,
          metadata,
        });
      }

      if (error instanceof PasswordResetStateUnavailableError) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private async handleResetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<ResetAdminPasswordResponse> {
    try {
      return await this.adminPasswordReset.resetPassword(
        email,
        code,
        newPassword,
      );
    } catch (error: unknown) {
      if (error instanceof AdminPasswordResetCodeInvalidError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }

      if (
        error instanceof PasswordResetStateUnavailableError ||
        error instanceof AdminSessionStateUnavailableError
      ) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: error.message,
        });
      }

      throw error;
    }
  }
}
