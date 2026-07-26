import type {
  ConfirmAttendeeEmailVerificationRequest,
  ResendAttendeeEmailVerificationRequest,
} from '@eventa/grpc-contracts';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class ConfirmAttendeeEmailVerificationDto implements ConfirmAttendeeEmailVerificationRequest {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}

export class ResendAttendeeEmailVerificationDto implements ResendAttendeeEmailVerificationRequest {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
