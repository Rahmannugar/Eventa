import { IsString, IsUUID, Matches } from 'class-validator';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class AuthenticateAdminSessionDto {
  @IsString()
  @Matches(SESSION_TOKEN_PATTERN)
  sessionToken!: string;
}

export class GetCurrentAdminAccountDto {
  @IsUUID()
  adminId!: string;
}

export class LogoutAdminDto {
  @IsString()
  @Matches(SESSION_TOKEN_PATTERN)
  sessionToken!: string;
}
