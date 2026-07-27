import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type LoginAttendeeResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import {
  IDENTITY_GRPC_CLIENT,
  IDENTITY_GRPC_DEADLINE_MS,
} from '../constants/attendee-registration.constants';
import { ApiHttpException } from '../../../http/errors/api-http.exception';
import type { DeadlineAwareAttendeeIdentityServiceClient } from '../types/attendee-identity-grpc-client.types';

export interface LoginAttendeeInput {
  email: string;
  password: string;
  requestId: string;
}

function readErrorField(error: unknown, field: string): unknown {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return undefined;
  }

  return Reflect.get(error, field);
}

@Injectable()
export class AttendeeLoginService implements OnModuleInit {
  private identityService?: DeadlineAwareAttendeeIdentityServiceClient;

  constructor(
    @Inject(IDENTITY_GRPC_CLIENT)
    private readonly grpcClient: ClientGrpc,
    @Inject(IDENTITY_GRPC_DEADLINE_MS)
    private readonly identityGrpcDeadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.identityService =
      this.grpcClient.getService<DeadlineAwareAttendeeIdentityServiceClient>(
        ATTENDEE_IDENTITY_SERVICE_NAME,
      );
  }

  async login(input: LoginAttendeeInput): Promise<LoginAttendeeResponse> {
    if (this.identityService === undefined) {
      throw this.unavailable('IDENTITY_CLIENT_UNAVAILABLE');
    }

    try {
      const metadata = new Metadata();
      metadata.set('x-request-id', input.requestId);
      return await firstValueFrom(
        this.identityService.loginAttendee(
          { email: input.email, password: input.password },
          metadata,
          {
            deadline: new Date(Date.now() + this.identityGrpcDeadlineMs),
          },
        ),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');
      const details = readErrorField(error, 'details');

      if (code === status.UNAUTHENTICATED) {
        throw new ApiHttpException(
          HttpStatus.UNAUTHORIZED,
          'INVALID_CREDENTIALS',
          'Email or password is incorrect.',
        );
      }

      if (code === status.FAILED_PRECONDITION) {
        if (details === 'ATTENDEE_ACCOUNT_DELETED') {
          throw new ApiHttpException(
            HttpStatus.FORBIDDEN,
            'ACCOUNT_DELETED',
            'This account has been deleted.',
          );
        }

        if (details === 'ATTENDEE_ACCOUNT_SUSPENDED') {
          throw new ApiHttpException(
            HttpStatus.FORBIDDEN,
            'ACCOUNT_SUSPENDED',
            'This account has been suspended.',
          );
        }

        throw new ApiHttpException(
          HttpStatus.FORBIDDEN,
          'EMAIL_VERIFICATION_REQUIRED',
          'Verify your email before signing in.',
        );
      }

      if (code === status.INVALID_ARGUMENT) {
        throw new ApiHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Check the login fields and try again.',
          { diagnosticCode: 'IDENTITY_VALIDATION_FAILED' },
        );
      }

      throw this.unavailable(
        code === status.DEADLINE_EXCEEDED
          ? 'IDENTITY_RPC_DEADLINE_EXCEEDED'
          : 'IDENTITY_RPC_UNAVAILABLE',
      );
    }
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AUTHENTICATION_UNAVAILABLE',
      'Sign in is temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
