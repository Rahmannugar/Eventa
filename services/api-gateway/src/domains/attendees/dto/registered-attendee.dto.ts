import type { RegisterAttendeeResponse } from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';

export class RegisteredAttendeeDto implements RegisterAttendeeResponse {
  @ApiProperty({ example: 'f3c1ab8f-b445-41f5-9d87-c434ae7fe223' })
  attendeeId!: string;

  @ApiProperty({ example: 'attendee@example.com' })
  email!: string;

  @ApiProperty({ example: false })
  emailVerified!: boolean;

  @ApiProperty({ example: 'event_fan' })
  username!: string;
}
