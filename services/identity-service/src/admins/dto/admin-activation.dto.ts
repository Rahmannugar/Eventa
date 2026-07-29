import type { ActivateAdminRequest } from '@eventa/grpc-contracts';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ActivateAdminDto implements ActivateAdminRequest {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Matches(/^\d{6}$/)
  otp!: string;
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
