export interface AdminLoginAccount {
  adminId: string;
  email: string;
  passwordHash: string;
}

export interface AdminLoginRepository {
  findActivatedForLogin(email: string): Promise<AdminLoginAccount | undefined>;
}

export interface LoggedInAdmin {
  adminId: string;
  email: string;
  sessionExpiresAt: string;
  sessionToken: string;
}
