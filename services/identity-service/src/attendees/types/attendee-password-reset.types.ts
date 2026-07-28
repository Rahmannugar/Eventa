export interface AttendeePasswordResetAccount {
  attendeeId: string;
  email: string;
}

export interface AttendeePasswordResetRepository {
  completedPasswordReset(
    attendeeId: string,
    resetId: string,
  ): Promise<boolean>;
  findAccountForPasswordReset(
    email: string,
  ): Promise<AttendeePasswordResetAccount | undefined>;
  replacePassword(
    attendeeId: string,
    passwordHash: string,
    resetId: string,
  ): Promise<boolean>;
}

export interface PasswordResetCode {
  attendeeId: string;
  code: string;
  email: string;
}
