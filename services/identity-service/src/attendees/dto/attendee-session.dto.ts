import { IsString, IsUUID, Matches } from 'class-validator';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class AuthenticateAttendeeSessionDto {
  @IsString()
  @Matches(SESSION_TOKEN_PATTERN)
  sessionToken!: string;
}

export class GetCurrentAttendeeAccountDto {
  @IsUUID()
  attendeeId!: string;
}

export class LogoutAttendeeDto {
  @IsString()
  @Matches(SESSION_TOKEN_PATTERN)
  sessionToken!: string;
}
