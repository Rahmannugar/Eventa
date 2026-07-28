import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ForgotAdminPasswordDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class ResetAdminPasswordDto {
  @IsString()
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
