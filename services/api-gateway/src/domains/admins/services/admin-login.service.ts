import {
  ADMIN_IDENTITY_SERVICE_NAME,
  type LoginAdminResponse,
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
export class AdminLoginService implements OnModuleInit {
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

  async login(
    email: string,
    password: string,
    requestId: string,
  ): Promise<LoginAdminResponse> {
    if (this.identity === undefined) {
      throw this.unavailable('IDENTITY_CLIENT_UNAVAILABLE');
    }

    try {
      const metadata = new Metadata();
      metadata.set('x-request-id', requestId);
      return await firstValueFrom(
        this.identity.loginAdmin({ email, password }, metadata, {
          deadline: new Date(Date.now() + this.deadlineMs),
        }),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');

      switch (code) {
        case status.UNAUTHENTICATED:
          throw new ApiHttpException(
            HttpStatus.UNAUTHORIZED,
            'INVALID_CREDENTIALS',
            'Email or password is incorrect.',
          );
        case status.INVALID_ARGUMENT:
          throw new ApiHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'VALIDATION_FAILED',
            'Check the login fields and try again.',
            { diagnosticCode: 'IDENTITY_VALIDATION_FAILED' },
          );
        case status.DEADLINE_EXCEEDED:
          throw this.unavailable('IDENTITY_RPC_DEADLINE_EXCEEDED');
        default:
          throw this.unavailable('IDENTITY_RPC_UNAVAILABLE');
      }
    }
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ADMIN_AUTHENTICATION_UNAVAILABLE',
      'Sign in is temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
