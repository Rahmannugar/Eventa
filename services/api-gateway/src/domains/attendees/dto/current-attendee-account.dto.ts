import type { GetCurrentAttendeeAccountResponse } from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';

export class CurrentAttendeeAccountDto implements GetCurrentAttendeeAccountResponse {
  @ApiProperty({ example: 'f3c1ab8f-b445-41f5-9d87-c434ae7fe223' })
  attendeeId!: string;

  @ApiProperty({ example: 'attendee@example.com' })
  email!: string;

  @ApiProperty({ example: true })
  emailVerified!: boolean;

  @ApiProperty({ example: 'active' })
  status!: string;

  @ApiProperty({ example: 'event_fan' })
  username!: string;
}
