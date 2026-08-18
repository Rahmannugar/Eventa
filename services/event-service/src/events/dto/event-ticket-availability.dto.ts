import type { GetAttendeeEventTicketCatalogueRequest } from '@eventa/grpc-contracts';
import { IsUUID } from 'class-validator';

export class GetAttendeeEventTicketCatalogueDto implements GetAttendeeEventTicketCatalogueRequest {
  @IsUUID()
  eventId!: string;

  @IsUUID()
  attendeeId!: string;
}
