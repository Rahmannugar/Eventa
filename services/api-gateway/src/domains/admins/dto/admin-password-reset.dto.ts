import type {
  ForgotAdminPasswordRequest,
  ForgotAdminPasswordResponse,
  ResetAdminPasswordRequest,
  ResetAdminPasswordResponse,
} from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ForgotAdminPasswordDto implements ForgotAdminPasswordRequest {
  @ApiProperty({ example: 'admin@example.com', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ForgotAdminPasswordResponseDto implements ForgotAdminPasswordResponse {
  @ApiProperty({ example: true })
  accepted!: boolean;
}

export class ResetAdminPasswordDto implements ResetAdminPasswordRequest {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @ApiProperty({ example: 'admin@example.com', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class ResetAdminPasswordResponseDto implements ResetAdminPasswordResponse {
  @ApiProperty({ example: true })
  passwordReset!: boolean;
}
