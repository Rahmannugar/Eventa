import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import {
  IDENTITY_GRPC_CLIENT,
  IDENTITY_GRPC_DEADLINE_MS,
} from '../constants/attendee-registration.constants';
import type { DeadlineAwareAttendeeIdentityServiceClient } from '../types/attendee-identity-grpc-client.types';
import { ApiHttpException } from '../../../http/errors/api-http.exception';
export interface RegisterAttendeeInput {
  email: string;
  password: string;
  requestId: string;
  username: string;
}

function readErrorField(error: unknown, field: string): unknown {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return undefined;
  }

  return Reflect.get(error, field);
}

@Injectable()
export class AttendeeRegistrationService implements OnModuleInit {
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

  async register(
    input: RegisterAttendeeInput,
  ): Promise<RegisterAttendeeResponse> {
    if (this.identityService === undefined) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'REGISTRATION_UNAVAILABLE',
        'Registration is temporarily unavailable. Try again later.',
        { diagnosticCode: 'IDENTITY_CLIENT_UNAVAILABLE' },
      );
    }

    try {
      const metadata = new Metadata();
      metadata.set('x-request-id', input.requestId);
      return await firstValueFrom(
        this.identityService.registerAttendee(
          {
            email: input.email,
            password: input.password,
            username: input.username,
          },
          metadata,
          {
            deadline: new Date(Date.now() + this.identityGrpcDeadlineMs),
          },
        ),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');
      const details = readErrorField(error, 'details');

      if (code === status.ALREADY_EXISTS) {
        const conflictCode =
          details === 'EMAIL_ALREADY_REGISTERED'
            ? 'EMAIL_ALREADY_REGISTERED'
            : 'USERNAME_UNAVAILABLE';
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          conflictCode,
          conflictCode === 'EMAIL_ALREADY_REGISTERED'
            ? 'An attendee account already uses this email address.'
            : 'Choose a different username.',
        );
      }

      if (code === status.INVALID_ARGUMENT) {
        throw new ApiHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Check the registration fields and try again.',
          { diagnosticCode: 'IDENTITY_VALIDATION_FAILED' },
        );
      }

      if (code === status.DEADLINE_EXCEEDED) {
        throw new ApiHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'REGISTRATION_UNAVAILABLE',
          'Registration is temporarily unavailable. Try again later.',
          { diagnosticCode: 'IDENTITY_RPC_DEADLINE_EXCEEDED' },
        );
      }

      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'REGISTRATION_UNAVAILABLE',
        'Registration is temporarily unavailable. Try again later.',
        { diagnosticCode: 'IDENTITY_RPC_UNAVAILABLE' },
      );
    }
  }
}
