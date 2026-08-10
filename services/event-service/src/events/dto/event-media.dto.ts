import {
  EventMediaSlot,
  type CreateEventMediaUploadRequest,
  type GetEventMediaUploadRequest,
  type RemoveEventMediaRequest,
} from '@eventa/grpc-contracts';
import { IsIn, IsInt, IsString, IsUUID, Max, Min } from 'class-validator';

import { EVENT_MEDIA_CONTENT_TYPES } from '../constants/event-media.constants';

export class CreateEventMediaUploadDto implements CreateEventMediaUploadRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @IsInt()
  @IsIn([1, 2, 3, 4, 5])
  slot!: EventMediaSlot;

  @IsString()
  @IsIn(EVENT_MEDIA_CONTENT_TYPES)
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @IsInt()
  @Min(1)
  @Max(8_388_608)
  sizeBytes!: number;
}

export class GetEventMediaUploadDto implements GetEventMediaUploadRequest {
  @IsUUID()
  eventId!: string;

  @IsUUID()
  uploadId!: string;
}

export class RemoveEventMediaDto implements RemoveEventMediaRequest {
  @IsUUID()
  adminId!: string;

  @IsUUID()
  eventId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;

  @IsInt()
  @IsIn([1, 2, 3, 4, 5])
  slot!: EventMediaSlot;
}
