import { resolve } from 'node:path';

import type { CallOptions, Metadata } from '@grpc/grpc-js';
import type { Observable } from 'rxjs';

import type {
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
} from './attendee-registration';

export const IDENTITY_PACKAGE_NAME = 'eventa.identity.v1';
export const ATTENDEE_IDENTITY_SERVICE_NAME = 'AttendeeIdentityService';

export interface AttendeeIdentityServiceClient {
  registerAttendee(
    request: RegisterAttendeeRequest,
    metadata?: Metadata,
    options?: CallOptions,
  ): Observable<RegisterAttendeeResponse>;
}

export interface AttendeeIdentityServiceController {
  registerAttendee(
    request: RegisterAttendeeRequest,
    metadata?: Metadata,
  ):
    | Promise<RegisterAttendeeResponse>
    | Observable<RegisterAttendeeResponse>
    | RegisterAttendeeResponse;
}

export function getIdentityProtoPath(): string {
  return resolve(
    __dirname,
    '../../../proto/identity/v1/attendee_identity_service.proto',
  );
}

export function getIdentityProtoIncludeDirs(): string[] {
  return [resolve(__dirname, '../../../proto')];
}
