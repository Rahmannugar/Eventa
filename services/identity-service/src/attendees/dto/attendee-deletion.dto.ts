import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class DeleteAttendeeAccountDto {
  @IsUUID()
  attendeeId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
