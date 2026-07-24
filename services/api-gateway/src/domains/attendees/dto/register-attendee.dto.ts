import type { RegisterAttendeeRequest } from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterAttendeeDto implements RegisterAttendeeRequest {
  @ApiProperty({ example: 'attendee@example.com', maxLength: 320 })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320, { message: 'Email must not exceed 320 characters.' })
  email!: string;

  @ApiProperty({ example: 'a-secure-password', minLength: 8, maxLength: 128 })
  @IsString({ message: 'Password must be text.' })
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters.' })
  password!: string;

  @ApiProperty({
    example: 'event_fan',
    minLength: 3,
    maxLength: 30,
    pattern: '^[a-zA-Z0-9_]+$',
  })
  @IsString({ message: 'Username must be text.' })
  @MinLength(3, { message: 'Username must be at least 3 characters.' })
  @MaxLength(30, { message: 'Username must not exceed 30 characters.' })
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Username may contain only letters, numbers, and underscores.',
  })
  username!: string;
}
