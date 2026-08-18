import type {
  GetEventWaitlistEntryRequest,
  JoinEventWaitlistRequest,
  LeaveEventWaitlistRequest,
} from '@eventa/grpc-contracts';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

class EventWaitlistIdentityDto {
  @IsUUID()
  eventId!: string;

  @IsUUID()
  ticketTypeId!: string;

  @IsUUID()
  attendeeId!: string;
}

export class JoinEventWaitlistDto
  extends EventWaitlistIdentityDto
  implements JoinEventWaitlistRequest
{
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}

export class LeaveEventWaitlistDto
  extends EventWaitlistIdentityDto
  implements LeaveEventWaitlistRequest {}

export class GetEventWaitlistEntryDto
  extends EventWaitlistIdentityDto
  implements GetEventWaitlistEntryRequest {}
