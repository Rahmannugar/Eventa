import type { LoginAdminRequest } from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginAdminDto implements LoginAdminRequest {
  @ApiProperty({ example: 'admin@example.com', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'a-secure-password', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class LoggedInAdminDto {
  @ApiProperty({ example: 'f3c1ab8f-b445-41f5-9d87-c434ae7fe223' })
  adminId!: string;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;
}
