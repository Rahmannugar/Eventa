import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type ConfirmAttendeeEmailVerificationResponse,
  type ResendAttendeeEmailVerificationResponse,
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

export interface ConfirmAttendeeEmailVerificationInput {
  email: string;
  otp: string;
  requestId: string;
}

export interface ResendAttendeeEmailVerificationInput {
  email: string;
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
  const retryAfterSeconds =
    typeof value === 'string' ? Number(value) : Number.NaN;

  return Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds
    : undefined;
}

@Injectable()
export class AttendeeEmailVerificationService implements OnModuleInit {
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

  async confirm(
    input: ConfirmAttendeeEmailVerificationInput,
  ): Promise<ConfirmAttendeeEmailVerificationResponse> {
    const identity = this.requireIdentityService();

    try {
      return await firstValueFrom(
        identity.confirmAttendeeEmailVerification(
          { email: input.email, otp: input.otp },
          this.requestMetadata(input.requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');

      if (code === status.FAILED_PRECONDITION) {
        throw new ApiHttpException(
          HttpStatus.BAD_REQUEST,
          'EMAIL_VERIFICATION_INVALID',
          'The verification code is invalid or has expired.',
        );
      }

      if (code === status.INVALID_ARGUMENT) {
        throw new ApiHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Check the email and verification code and try again.',
          { diagnosticCode: 'IDENTITY_VALIDATION_FAILED' },
        );
      }

      throw this.unavailable(error);
    }
  }

  async resend(
    input: ResendAttendeeEmailVerificationInput,
  ): Promise<ResendAttendeeEmailVerificationResponse> {
    const identity = this.requireIdentityService();

    try {
      return await firstValueFrom(
        identity.resendAttendeeEmailVerification(
          { email: input.email },
          this.requestMetadata(input.requestId),
          this.deadline(),
        ),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');

      if (code === status.RESOURCE_EXHAUSTED) {
        const retryAfterSeconds = readRetryAfterSeconds(error);
        throw new ApiHttpException(
          HttpStatus.TOO_MANY_REQUESTS,
          'EMAIL_VERIFICATION_RESEND_RATE_LIMITED',
          'Wait before requesting another verification email.',
          {
            ...(retryAfterSeconds === undefined
              ? {}
              : { headers: { 'Retry-After': String(retryAfterSeconds) } }),
          },
        );
      }

      if (code === status.INVALID_ARGUMENT) {
        throw new ApiHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Check the email address and try again.',
          { diagnosticCode: 'IDENTITY_VALIDATION_FAILED' },
        );
      }

      throw this.unavailable(error);
    }
  }

  private deadline(): { deadline: Date } {
    return {
      deadline: new Date(Date.now() + this.identityGrpcDeadlineMs),
    };
  }

  private requestMetadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private requireIdentityService(): DeadlineAwareAttendeeIdentityServiceClient {
    if (this.identityService === undefined) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'EMAIL_VERIFICATION_UNAVAILABLE',
        'Email verification is temporarily unavailable. Try again later.',
        { diagnosticCode: 'IDENTITY_CLIENT_UNAVAILABLE' },
      );
    }

    return this.identityService;
  }

  private unavailable(error: unknown): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'EMAIL_VERIFICATION_UNAVAILABLE',
      'Email verification is temporarily unavailable. Try again later.',
      {
        diagnosticCode:
          readErrorField(error, 'code') === status.DEADLINE_EXCEEDED
            ? 'IDENTITY_RPC_DEADLINE_EXCEEDED'
            : 'IDENTITY_RPC_UNAVAILABLE',
      },
    );
  }
}
