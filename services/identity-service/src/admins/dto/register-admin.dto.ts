import { IsEmail, IsString, MaxLength } from 'class-validator';

export class RegisterAdminDto {
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
