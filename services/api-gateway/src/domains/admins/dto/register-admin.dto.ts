import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class RegisterAdminDto {
  @ApiProperty({ example: 'admin@example.com', maxLength: 320 })
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class RegisterAdminResponseDto {
  @ApiProperty({ example: true })
  accepted!: boolean;
}
