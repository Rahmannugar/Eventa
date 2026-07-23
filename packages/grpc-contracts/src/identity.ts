import { resolve } from 'node:path';

import type { Observable } from 'rxjs';
import type { CallOptions, Metadata } from '@grpc/grpc-js';

export const IDENTITY_PACKAGE_NAME = 'eventa.identity.v1';
export const ATTENDEE_IDENTITY_SERVICE_NAME = 'AttendeeIdentityService';

export interface RegisterAttendeeRequest {
  email: string;
  password: string;
  username: string;
}

export interface RegisterAttendeeResponse {
  attendeeId: string;
  email: string;
  username: string;
  emailVerified: boolean;
}

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
  return resolve(__dirname, '../proto/identity.proto');
}
