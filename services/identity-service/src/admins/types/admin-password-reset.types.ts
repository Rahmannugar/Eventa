export interface AdminPasswordResetAccount {
  adminId: string;
  email: string;
}

export interface AdminPasswordResetRepository {
  findActivatedForPasswordReset(
    email: string,
  ): Promise<AdminPasswordResetAccount | undefined>;
  replacePassword(adminId: string, passwordHash: string): Promise<boolean>;
}

export interface AdminPasswordResetCode {
  adminId: string;
  code: string;
  email: string;
}
