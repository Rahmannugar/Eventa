import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ADMIN_IDENTITY_SERVICE_NAME,
  type ForgotAdminPasswordResponse,
  type ResetAdminPasswordResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import {
  ADMIN_IDENTITY_GRPC_CLIENT,
  ADMIN_IDENTITY_GRPC_DEADLINE_MS,
} from '../constants/admin-registration.constants';
import type { DeadlineAwareAdminIdentityServiceClient } from '../types/admin-identity-grpc-client.types';

function readField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? Reflect.get(error, field)
    : undefined;
}

function readRetryAfter(error: unknown): number | undefined {
  const metadata = readField(error, 'metadata');

  if (!(metadata instanceof Metadata)) {
    return undefined;
  }

  const seconds = Number(metadata.get('retry-after')[0]);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

@Injectable()
export class AdminPasswordResetService implements OnModuleInit {
  private identity?: DeadlineAwareAdminIdentityServiceClient;

  constructor(
    @Inject(ADMIN_IDENTITY_GRPC_CLIENT)
    private readonly grpcClient: ClientGrpc,
    @Inject(ADMIN_IDENTITY_GRPC_DEADLINE_MS)
    private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.identity =
      this.grpcClient.getService<DeadlineAwareAdminIdentityServiceClient>(
        ADMIN_IDENTITY_SERVICE_NAME,
      );
  }

  async forgotPassword(
    email: string,
    requestId: string,
  ): Promise<ForgotAdminPasswordResponse> {
    const identity = this.requireClient();

    try {
      return await firstValueFrom(
        identity.forgotAdminPassword(
          { email },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      switch (readField(error, 'code')) {
        case status.RESOURCE_EXHAUSTED: {
          const retryAfter = readRetryAfter(error);
          throw new ApiHttpException(
            HttpStatus.TOO_MANY_REQUESTS,
            'ADMIN_PASSWORD_RESET_RATE_LIMITED',
            'Wait before requesting another password reset email.',
            retryAfter === undefined
              ? {}
              : { headers: { 'Retry-After': String(retryAfter) } },
          );
        }
        case status.INVALID_ARGUMENT:
          throw this.validation('Check the email address and try again.');
        default:
          throw this.unavailable(error);
      }
    }
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
    requestId: string,
  ): Promise<ResetAdminPasswordResponse> {
    const identity = this.requireClient();

    try {
      return await firstValueFrom(
        identity.resetAdminPassword(
          { code, email, newPassword },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      switch (readField(error, 'code')) {
        case status.FAILED_PRECONDITION:
          throw new ApiHttpException(
            HttpStatus.BAD_REQUEST,
            'ADMIN_PASSWORD_RESET_INVALID',
            'The password reset code is invalid or has expired.',
          );
        case status.INVALID_ARGUMENT:
          throw this.validation(
            'Check the email, reset code, and new password and try again.',
          );
        default:
          throw this.unavailable(error);
      }
    }
  }

  private deadline(): { deadline: Date } {
    return { deadline: new Date(Date.now() + this.deadlineMs) };
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private requireClient(): DeadlineAwareAdminIdentityServiceClient {
    if (this.identity === undefined) {
      throw this.unavailable();
    }

    return this.identity;
  }

  private unavailable(error?: unknown): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ADMIN_PASSWORD_RESET_UNAVAILABLE',
      'Password reset is temporarily unavailable. Try again later.',
      {
        diagnosticCode:
          readField(error, 'code') === status.DEADLINE_EXCEEDED
            ? 'IDENTITY_RPC_DEADLINE_EXCEEDED'
            : 'IDENTITY_RPC_UNAVAILABLE',
      },
    );
  }

  private validation(message: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
      message,
      { diagnosticCode: 'IDENTITY_VALIDATION_FAILED' },
    );
  }
}
