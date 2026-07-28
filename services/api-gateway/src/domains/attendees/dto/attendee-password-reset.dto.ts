import type {
  ForgotAttendeePasswordResponse,
  ResetAttendeePasswordResponse,
} from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ForgotAttendeePasswordDto {
  @ApiProperty({ example: 'attendee@example.com', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ForgotAttendeePasswordResponseDto
  implements ForgotAttendeePasswordResponse
{
  @ApiProperty({ example: true })
  accepted!: boolean;
}

export class ResetAttendeePasswordDto {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @Matches(/^\d{6}$/)
  code!: string;

  @ApiProperty({ example: 'attendee@example.com', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ maxLength: 128, minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class ResetAttendeePasswordResponseDto
  implements ResetAttendeePasswordResponse
{
  @ApiProperty({ example: true })
  passwordReset!: boolean;
}
