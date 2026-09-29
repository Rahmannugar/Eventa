import {
  DISCOVERY_SERVICE_NAME,
  type GetAttendeeInterestsResponse,
  type SetAttendeeInterestsResponse,
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
  DISCOVERY_GRPC_CLIENT,
  DISCOVERY_GRPC_DEADLINE_MS,
} from '../constants/discovery.constants';
import type {
  AttendeeInterestsDto,
  SetAttendeeInterestsDto,
} from '../dto/discovery-interests.dto';
import type { DeadlineAwareDiscoveryClient } from '../types/discovery-grpc-client.types';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class DiscoveryInterestsService implements OnModuleInit {
  private discovery?: DeadlineAwareDiscoveryClient;

  constructor(
    @Inject(DISCOVERY_GRPC_CLIENT) private readonly grpcClient: ClientGrpc,
    @Inject(DISCOVERY_GRPC_DEADLINE_MS) private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.discovery = this.grpcClient.getService<DeadlineAwareDiscoveryClient>(
      DISCOVERY_SERVICE_NAME,
    );
  }

  async get(attendeeId: string, requestId: string): Promise<AttendeeInterestsDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().getAttendeeInterests(
          { attendeeId },
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      return this.toDto(response, attendeeId);
    } catch (error: unknown) {
      throw this.translate(error);
    }
  }

  async set(
    attendeeId: string,
    dto: SetAttendeeInterestsDto,
    requestId: string,
  ): Promise<AttendeeInterestsDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().setAttendeeInterests(
          { attendeeId, interests: dto.interests },
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      return this.toDto(response, attendeeId);
    } catch (error: unknown) {
      throw this.translate(error);
    }
  }

  // toDto re-reads the response rather than trusting it: interests for a
  // different attendee, or an answer without one, are not safe to return as
  // the caller's own preferences.
  private toDto(
    response: GetAttendeeInterestsResponse | SetAttendeeInterestsResponse,
    attendeeId: string,
  ): AttendeeInterestsDto {
    if (response.attendeeId !== attendeeId || !Array.isArray(response.interests)) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DISCOVERY_SERVICE_UNAVAILABLE',
        'Interests are temporarily unavailable. Try again later.',
        { diagnosticCode: 'DISCOVERY_INTERESTS_RESPONSE_INVALID' },
      );
    }
    return {
      interests: response.interests,
      updatedAt: response.updatedAt === '' ? undefined : response.updatedAt,
    };
  }

  private translate(error: unknown): unknown {
    if (error instanceof ApiHttpException) return error;
    if (errorCode(error) === status.INVALID_ARGUMENT) {
      return new ApiHttpException(
        HttpStatus.BAD_REQUEST,
        'INTERESTS_INVALID',
        'Those interests could not be saved.',
      );
    }
    if (errorCode(error) === status.DEADLINE_EXCEEDED) {
      return new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DISCOVERY_SERVICE_UNAVAILABLE',
        'Interests are temporarily unavailable. Try again later.',
        { diagnosticCode: 'DISCOVERY_INTERESTS_RPC_DEADLINE_EXCEEDED' },
      );
    }
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'DISCOVERY_SERVICE_UNAVAILABLE',
      'Interests are temporarily unavailable. Try again later.',
      { diagnosticCode: 'DISCOVERY_INTERESTS_RPC_UNAVAILABLE' },
    );
  }

  private requireClient(): DeadlineAwareDiscoveryClient {
    if (this.discovery === undefined) {
      throw new ApiHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DISCOVERY_SERVICE_UNAVAILABLE',
        'Interests are temporarily unavailable. Try again later.',
        { diagnosticCode: 'DISCOVERY_INTERESTS_CLIENT_UNAVAILABLE' },
      );
    }
    return this.discovery;
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }
}
