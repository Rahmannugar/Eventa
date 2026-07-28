import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ADMIN_IDENTITY_SERVICE_NAME,
  type AuthenticateAdminSessionResponse,
  type GetCurrentAdminAccountResponse,
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

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class AdminSessionService implements OnModuleInit {
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

  async authenticate(
    token: string,
    requestId: string,
  ): Promise<AuthenticateAdminSessionResponse> {
    const identity = this.requireClient();

    try {
      return await firstValueFrom(
        identity.authenticateAdminSession(
          { sessionToken: token },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      this.translateAuthenticationError(error);
    }
  }

  async getCurrentAccount(
    adminId: string,
    requestId: string,
  ): Promise<GetCurrentAdminAccountResponse> {
    const identity = this.requireClient();

    try {
      return await firstValueFrom(
        identity.getCurrentAdminAccount(
          { adminId },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      this.translateAuthenticationError(error);
    }
  }

  async logout(token: string, requestId: string): Promise<void> {
    const identity = this.requireClient();

    try {
      await firstValueFrom(
        identity.logoutAdmin(
          { sessionToken: token },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      throw this.unavailable(error);
    }
  }

  private deadline() {
    return { deadline: new Date(Date.now() + this.deadlineMs) };
  }

  private invalid(): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.UNAUTHORIZED,
      'ADMIN_SESSION_INVALID',
      'Sign in to continue.',
    );
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private requireClient(): DeadlineAwareAdminIdentityServiceClient {
    if (this.identity === undefined) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ADMIN_AUTHENTICATION_UNAVAILABLE',
        'Authentication is temporarily unavailable. Try again later.',
        { diagnosticCode: 'IDENTITY_CLIENT_UNAVAILABLE' },
      );
    }

    return this.identity;
  }

  private translateAuthenticationError(error: unknown): never {
    switch (readErrorCode(error)) {
      case status.UNAUTHENTICATED:
        throw this.invalid();
      default:
        throw this.unavailable(error);
    }
  }

  private unavailable(error: unknown): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ADMIN_AUTHENTICATION_UNAVAILABLE',
      'Authentication is temporarily unavailable. Try again later.',
      {
        diagnosticCode:
          readErrorCode(error) === status.DEADLINE_EXCEEDED
            ? 'IDENTITY_RPC_DEADLINE_EXCEEDED'
            : 'IDENTITY_RPC_UNAVAILABLE',
      },
    );
  }
}
