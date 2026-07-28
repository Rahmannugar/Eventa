export interface AttendeePasswordResetAccount {
  attendeeId: string;
  email: string;
}

export interface AttendeePasswordResetRepository {
  findAccountForPasswordReset(
    email: string,
  ): Promise<AttendeePasswordResetAccount | undefined>;
  replacePassword(attendeeId: string, passwordHash: string): Promise<boolean>;
}

export interface PasswordResetCode {
  attendeeId: string;
  code: string;
  email: string;
}
