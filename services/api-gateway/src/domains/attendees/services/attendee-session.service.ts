import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type AuthenticateAttendeeSessionResponse,
  type GetCurrentAttendeeAccountResponse,
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

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class AttendeeSessionService implements OnModuleInit {
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

  async authenticate(
    token: string,
    requestId: string,
  ): Promise<AuthenticateAttendeeSessionResponse> {
    const identity = this.requireClient();

    try {
      return await firstValueFrom(
        identity.authenticateAttendeeSession(
          { sessionToken: token },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      if (readErrorCode(error) === status.UNAUTHENTICATED) {
        throw this.invalid();
      }

      throw this.unavailable(error);
    }
  }

  async getCurrentAccount(
    attendeeId: string,
    requestId: string,
  ): Promise<GetCurrentAttendeeAccountResponse> {
    const identity = this.requireClient();

    try {
      return await firstValueFrom(
        identity.getCurrentAttendeeAccount(
          { attendeeId },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      if (readErrorCode(error) === status.UNAUTHENTICATED) {
        throw this.invalid();
      }

      throw this.unavailable(error);
    }
  }

  async logout(token: string, requestId: string): Promise<void> {
    const identity = this.requireClient();

    try {
      await firstValueFrom(
        identity.logoutAttendee(
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
      'SESSION_INVALID',
      'Sign in to continue.',
    );
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private requireClient(): DeadlineAwareAttendeeIdentityServiceClient {
    if (this.identity === undefined) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTHENTICATION_UNAVAILABLE',
        'Authentication is temporarily unavailable. Try again later.',
        { diagnosticCode: 'IDENTITY_CLIENT_UNAVAILABLE' },
      );
    }

    return this.identity;
  }

  private unavailable(error: unknown): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AUTHENTICATION_UNAVAILABLE',
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
