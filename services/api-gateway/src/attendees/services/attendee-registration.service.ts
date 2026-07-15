import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type AttendeeIdentityServiceClient,
  type RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { IDENTITY_GRPC_CLIENT } from '../constants/attendee-registration.constants';
import type { RegisterAttendeeDto } from '../dto/register-attendee.dto';

function readErrorField(error: unknown, field: string): unknown {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return undefined;
  }

  return Reflect.get(error, field);
}

@Injectable()
export class AttendeeRegistrationService implements OnModuleInit {
  private identityService?: AttendeeIdentityServiceClient;

  constructor(
    @Inject(IDENTITY_GRPC_CLIENT)
    private readonly grpcClient: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.identityService =
      this.grpcClient.getService<AttendeeIdentityServiceClient>(
        ATTENDEE_IDENTITY_SERVICE_NAME,
      );
  }

  async register(
    request: RegisterAttendeeDto,
  ): Promise<RegisterAttendeeResponse> {
    if (this.identityService === undefined) {
      throw new ServiceUnavailableException('Identity service unavailable');
    }

    try {
      return await firstValueFrom(
        this.identityService.registerAttendee(request),
      );
    } catch (error: unknown) {
      const code = readErrorField(error, 'code');
      const details = readErrorField(error, 'details');

      if (code === status.ALREADY_EXISTS) {
        throw new ConflictException(
          typeof details === 'string' ? details : 'ATTENDEE_ALREADY_EXISTS',
        );
      }

      if (code === status.INVALID_ARGUMENT) {
        throw new BadRequestException('INVALID_REGISTRATION_REQUEST');
      }

      throw new ServiceUnavailableException('Identity service unavailable');
    }
  }
}
