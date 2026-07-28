import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type ForgotAttendeePasswordResponse,
  type ResetAttendeePasswordResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import {
  IDENTITY_GRPC_CLIENT,
  IDENTITY_GRPC_DEADLINE_MS,
} from '../constants/attendee-registration.constants';
import type { DeadlineAwareAttendeeIdentityServiceClient } from '../types/attendee-identity-grpc-client.types';

interface ForgotPasswordInput {
  email: string;
  requestId: string;
}

interface ResetPasswordInput {
  code: string;
  email: string;
  newPassword: string;
  requestId: string;
}

function readErrorField(error: unknown, field: string): unknown {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return undefined;
  }

  return Reflect.get(error, field);
}

function readRetryAfterSeconds(error: unknown): number | undefined {
  const metadata = readErrorField(error, 'metadata');

  if (!(metadata instanceof Metadata)) {
    return undefined;
  }

  const value = metadata.get('retry-after')[0];
  const seconds = typeof value === 'string' ? Number(value) : Number.NaN;

  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

@Injectable()
export class AttendeePasswordResetService implements OnModuleInit {
  private identity?: DeadlineAwareAttendeeIdentityServiceClient;

  constructor(
    @Inject(IDENTITY_GRPC_CLIENT)
    private readonly grpcClient: ClientGrpc,
    @Inject(IDENTITY_GRPC_DEADLINE_MS)
    private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.identity =
      this.grpcClient.getService<DeadlineAwareAttendeeIdentityServiceClient>(
        ATTENDEE_IDENTITY_SERVICE_NAME,
      );
  }

  async forgotPassword(
    input: ForgotPasswordInput,
  ): Promise<ForgotAttendeePasswordResponse> {
    const identity = this.requireIdentity();

    try {
      return await firstValueFrom(
        identity.forgotAttendeePassword(
          { email: input.email },
          this.metadata(input.requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');

      if (code === status.RESOURCE_EXHAUSTED) {
        const retryAfterSeconds = readRetryAfterSeconds(error);
        throw new ApiHttpException(
          HttpStatus.TOO_MANY_REQUESTS,
          'PASSWORD_RESET_RATE_LIMITED',
          'Wait before requesting another password reset email.',
          {
            ...(retryAfterSeconds === undefined
              ? {}
              : { headers: { 'Retry-After': String(retryAfterSeconds) } }),
          },
        );
      }

      if (code === status.INVALID_ARGUMENT) {
        throw this.validation('Check the email address and try again.');
      }

      throw this.unavailable(error);
    }
  }

  async resetPassword(
    input: ResetPasswordInput,
  ): Promise<ResetAttendeePasswordResponse> {
    const identity = this.requireIdentity();

    try {
      return await firstValueFrom(
        identity.resetAttendeePassword(
          {
            code: input.code,
            email: input.email,
            newPassword: input.newPassword,
          },
          this.metadata(input.requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');

      if (code === status.FAILED_PRECONDITION) {
        throw new ApiHttpException(
          HttpStatus.BAD_REQUEST,
          'PASSWORD_RESET_INVALID',
          'The password reset code is invalid or has expired.',
        );
      }

      if (code === status.INVALID_ARGUMENT) {
        throw this.validation(
          'Check the email, reset code, and new password and try again.',
        );
      }

      throw this.unavailable(error);
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

  private requireIdentity(): DeadlineAwareAttendeeIdentityServiceClient {
    if (this.identity === undefined) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PASSWORD_RESET_UNAVAILABLE',
        'Password reset is temporarily unavailable. Try again later.',
        { diagnosticCode: 'IDENTITY_CLIENT_UNAVAILABLE' },
      );
    }

    return this.identity;
  }

  private unavailable(error: unknown): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'PASSWORD_RESET_UNAVAILABLE',
      'Password reset is temporarily unavailable. Try again later.',
      {
        diagnosticCode:
          readErrorField(error, 'code') === status.DEADLINE_EXCEEDED
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
