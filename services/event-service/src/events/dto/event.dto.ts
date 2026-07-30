import type {
  CreateDraftEventRequest,
  GetAdminEventRequest,
} from '@eventa/grpc-contracts';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDraftEventDto implements CreateDraftEventRequest {
  @IsUUID()
  adminId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;
}

export class GetAdminEventDto implements GetAdminEventRequest {
  @IsUUID()
  eventId!: string;
}
