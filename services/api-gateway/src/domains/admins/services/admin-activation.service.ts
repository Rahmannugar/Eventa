import {
  ADMIN_IDENTITY_SERVICE_NAME,
  type CompleteAdminActivationResponse,
  type ConfirmAdminActivationResponse,
  type RegisterAdminResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import {
  ADMIN_IDENTITY_GRPC_CLIENT,
  ADMIN_IDENTITY_GRPC_DEADLINE_MS,
} from '../constants/admin-registration.constants';
import type { DeadlineAwareAdminIdentityServiceClient } from '../types/admin-identity-grpc-client.types';

function readErrorField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? Reflect.get(error, field)
    : undefined;
}

@Injectable()
export class AdminActivationService implements OnModuleInit {
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

  async register(
    email: string,
    requestId: string,
  ): Promise<RegisterAdminResponse> {
    const identity = this.requireIdentity();

    try {
      return await firstValueFrom(
        identity.registerAdmin(
          { email },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      switch (readErrorField(error, 'code')) {
        case status.RESOURCE_EXHAUSTED: {
          const metadata = readErrorField(error, 'metadata');
          const retryAfter =
            metadata instanceof Metadata
              ? metadata.get('retry-after')[0]
              : undefined;
          throw new ApiHttpException(
            HttpStatus.TOO_MANY_REQUESTS,
            'ADMIN_REGISTRATION_RATE_LIMITED',
            'Wait before requesting another admin activation email.',
            {
              ...(typeof retryAfter === 'string'
                ? { headers: { 'Retry-After': retryAfter } }
                : {}),
            },
          );
        }
        case status.DEADLINE_EXCEEDED:
          throw this.unavailable('IDENTITY_RPC_DEADLINE_EXCEEDED');
        default:
          throw this.unavailable('IDENTITY_RPC_UNAVAILABLE');
      }
    }
  }

  async confirm(
    email: string,
    otp: string,
    requestId: string,
  ): Promise<ConfirmAdminActivationResponse> {
    const identity = this.requireIdentity();

    try {
      return await firstValueFrom(
        identity.confirmAdminActivation(
          { email, otp },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      switch (readErrorField(error, 'code')) {
        case status.FAILED_PRECONDITION:
          throw new ApiHttpException(
            HttpStatus.BAD_REQUEST,
            'ADMIN_ACTIVATION_OTP_INVALID',
            'The activation code is invalid or has expired.',
          );
        case status.INVALID_ARGUMENT:
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'VALIDATION_FAILED',
            'Check the email and activation code and try again.',
          );
        case status.DEADLINE_EXCEEDED:
          throw this.unavailable('IDENTITY_RPC_DEADLINE_EXCEEDED');
        default:
          throw this.unavailable('IDENTITY_RPC_UNAVAILABLE');
      }
    }
  }

  async complete(
    activationToken: string | undefined,
    password: string,
    requestId: string,
  ): Promise<CompleteAdminActivationResponse> {
    if (activationToken === undefined) {
      throw new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        'ADMIN_ACTIVATION_REQUIRED',
        'Confirm the activation code before setting a password.',
      );
    }

    const identity = this.requireIdentity();

    try {
      return await firstValueFrom(
        identity.completeAdminActivation(
          { activationToken, password },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      switch (readErrorField(error, 'code')) {
        case status.FAILED_PRECONDITION:
          throw new ApiHttpException(
            HttpStatus.BAD_REQUEST,
            'ADMIN_ACTIVATION_REQUIRED',
            'Confirm the activation code before setting a password.',
          );
        case status.INVALID_ARGUMENT:
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'VALIDATION_FAILED',
            'Check the password and try again.',
          );
        case status.DEADLINE_EXCEEDED:
          throw this.unavailable('IDENTITY_RPC_DEADLINE_EXCEEDED');
        default:
          throw this.unavailable('IDENTITY_RPC_UNAVAILABLE');
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

  private requireIdentity(): DeadlineAwareAdminIdentityServiceClient {
    if (this.identity === undefined) {
      throw this.unavailable('IDENTITY_CLIENT_UNAVAILABLE');
    }

    return this.identity;
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ADMIN_ACTIVATION_UNAVAILABLE',
      'Admin activation is temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
