import type {
  ConfirmAttendeeEmailVerificationRequest,
  ConfirmAttendeeEmailVerificationResponse,
  ResendAttendeeEmailVerificationRequest,
  ResendAttendeeEmailVerificationResponse,
} from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class ConfirmAttendeeEmailVerificationDto implements ConfirmAttendeeEmailVerificationRequest {
  @ApiProperty({ example: 'attendee@example.com', maxLength: 320 })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320, { message: 'Email must not exceed 320 characters.' })
  email!: string;

  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @IsString({ message: 'Verification code must be text.' })
  @Matches(/^\d{6}$/, {
    message: 'Verification code must contain exactly 6 digits.',
  })
  otp!: string;
}

export class ResendAttendeeEmailVerificationDto implements ResendAttendeeEmailVerificationRequest {
  @ApiProperty({ example: 'attendee@example.com', maxLength: 320 })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320, { message: 'Email must not exceed 320 characters.' })
  email!: string;
}

export class ConfirmAttendeeEmailVerificationResponseDto implements ConfirmAttendeeEmailVerificationResponse {
  @ApiProperty({ example: true })
  emailVerified!: boolean;
}

export class ResendAttendeeEmailVerificationResponseDto implements ResendAttendeeEmailVerificationResponse {
  @ApiProperty({ example: true })
  accepted!: boolean;
}
