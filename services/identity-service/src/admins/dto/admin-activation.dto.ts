import type {
  CompleteAdminActivationRequest,
  ConfirmAdminActivationRequest,
} from '@eventa/grpc-contracts';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConfirmAdminActivationDto implements ConfirmAdminActivationRequest {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Matches(/^\d{6}$/)
  otp!: string;
}

export class CompleteAdminActivationDto implements CompleteAdminActivationRequest {
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  activationToken!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
