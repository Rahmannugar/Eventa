import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ForgotAttendeePasswordDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetAttendeePasswordDto {
  @Matches(/^\d{6}$/)
  code!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
