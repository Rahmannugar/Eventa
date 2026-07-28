import {
  AdminIdentityServiceControllerMethods,
  type CompleteAdminActivationResponse,
  type ConfirmAdminActivationResponse,
  type AdminIdentityServiceController,
  type RegisterAdminResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { from, type Observable } from 'rxjs';

import { RegisterAdminDto } from '../dto/register-admin.dto';
import {
  CompleteAdminActivationDto,
  ConfirmAdminActivationDto,
} from '../dto/admin-activation.dto';
import {
  AdminActivationGrantInvalidError,
  AdminActivationOtpInvalidError,
  AdminActivationRateLimitedError,
  AdminActivationStateUnavailableError,
} from '../errors/admin-activation.errors';
import { AdminActivationService } from '../services/admin-activation.service';

@Controller()
@AdminIdentityServiceControllerMethods()
export class AdminIdentityController implements AdminIdentityServiceController {
  constructor(private readonly adminActivation: AdminActivationService) {}

  registerAdmin(request: RegisterAdminDto): Observable<RegisterAdminResponse> {
    return from(this.handleRegistration(request.email));
  }

  confirmAdminActivation(
    request: ConfirmAdminActivationDto,
  ): Observable<ConfirmAdminActivationResponse> {
    return from(this.handleConfirmation(request));
  }

  completeAdminActivation(
    request: CompleteAdminActivationDto,
  ): Observable<CompleteAdminActivationResponse> {
    return from(this.handleCompletion(request));
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

  private async handleConfirmation(
    request: ConfirmAdminActivationDto,
  ): Promise<ConfirmAdminActivationResponse> {
    try {
      return await this.adminActivation.confirm(request.email, request.otp);
    } catch (error: unknown) {
      this.translateActivationError(error);
    }
  }

  private async handleCompletion(
    request: CompleteAdminActivationDto,
  ): Promise<CompleteAdminActivationResponse> {
    try {
      return await this.adminActivation.complete(
        request.activationToken,
        request.password,
      );
    } catch (error: unknown) {
      this.translateActivationError(error);
    }
  }

  private translateActivationError(error: unknown): never {
    if (
      error instanceof AdminActivationOtpInvalidError ||
      error instanceof AdminActivationGrantInvalidError
    ) {
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
}
