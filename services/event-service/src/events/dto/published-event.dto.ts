import type { GetPublishedEventRequest } from '@eventa/grpc-contracts';
import { IsUUID } from 'class-validator';

export class GetPublishedEventDto implements GetPublishedEventRequest {
  @IsUUID()
  eventId!: string;
}
