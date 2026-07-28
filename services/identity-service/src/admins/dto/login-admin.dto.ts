import type { LoginAdminRequest } from '@eventa/grpc-contracts';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class LoginAdminDto implements LoginAdminRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}
