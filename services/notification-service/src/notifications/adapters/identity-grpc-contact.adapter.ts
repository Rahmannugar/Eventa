import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type AttendeeIdentityServiceClient,
  type GetAttendeeContactResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import type { OnModuleInit } from '@nestjs/common';
import { firstValueFrom, type Observable } from 'rxjs';

import { AttendeeContactNotFoundError } from '../errors/cancellation-email.errors';
import type {
  AttendeeContact,
  AttendeeContactProvider,
} from '../ports/attendee-contact.provider';

interface DeadlineAwareGetAttendeeContact {
  (
    request: { attendeeId: string },
    metadata: Metadata,
    options: { deadline: Date },
  ): Observable<GetAttendeeContactResponse>;
}

export class IdentityGrpcContactAdapter
  implements AttendeeContactProvider, OnModuleInit
{
  private client: AttendeeIdentityServiceClient | undefined;

  constructor(
    private readonly grpcClient: ClientGrpc,
    private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<AttendeeIdentityServiceClient>(
      ATTENDEE_IDENTITY_SERVICE_NAME,
    );
  }

  async getContact(attendeeId: string): Promise<AttendeeContact> {
    const client = this.client;

    if (client === undefined) {
      throw new AttendeeContactNotFoundError();
    }

    const getAttendeeContact = client.getAttendeeContact.bind(
      client,
    ) as unknown as DeadlineAwareGetAttendeeContact;

    try {
      const response = await firstValueFrom(
        getAttendeeContact(
          { attendeeId },
          IdentityGrpcContactAdapter.metadata(),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );

      return { attendeeId: response.attendeeId, email: response.email };
    } catch (error: unknown) {
      if (isNotFound(error)) {
        throw new AttendeeContactNotFoundError();
      }

      throw error;
    }
  }

  private static metadata(): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', crypto.randomUUID());
    return metadata;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (error as { code?: number }).code === status.NOT_FOUND;
}
