import type {
  GetPublishedEventRequest,
  ListRecommendableEventsByIdsRequest,
} from '@eventa/grpc-contracts';
import { ArrayMaxSize, ArrayNotEmpty, IsUUID } from 'class-validator';

export class GetPublishedEventDto implements GetPublishedEventRequest {
  @IsUUID()
  eventId!: string;
}

export class ListRecommendableEventsByIdsDto
  implements ListRecommendableEventsByIdsRequest
{
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  eventIds!: string[];
}
