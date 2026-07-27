import type { LoginAttendeeRequest } from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginAttendeeDto implements LoginAttendeeRequest {
  @ApiProperty({ example: 'attendee@example.com', maxLength: 320 })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320, { message: 'Email must not exceed 320 characters.' })
  email!: string;

  @ApiProperty({ example: 'a-secure-password', minLength: 8, maxLength: 128 })
  @IsString({ message: 'Password must be text.' })
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters.' })
  password!: string;
}

export class LoggedInAttendeeDto {
  @ApiProperty({ example: 'f3c1ab8f-b445-41f5-9d87-c434ae7fe223' })
  attendeeId!: string;

  @ApiProperty({ example: 'attendee@example.com' })
  email!: string;

  @ApiProperty({ example: true })
  emailVerified!: true;

  @ApiProperty({ example: 'active' })
  status!: 'active';

  @ApiProperty({ example: 'event_fan' })
  username!: string;
}
