export interface AdminPasswordResetAccount {
  adminId: string;
  email: string;
}

export interface AdminPasswordResetRepository {
  completedPasswordReset(adminId: string, resetId: string): Promise<boolean>;
  findActivatedForPasswordReset(
    email: string,
  ): Promise<AdminPasswordResetAccount | undefined>;
  replacePassword(
    adminId: string,
    passwordHash: string,
    resetId: string,
  ): Promise<boolean>;
}

export interface AdminPasswordResetCode {
  adminId: string;
  code: string;
  email: string;
}
