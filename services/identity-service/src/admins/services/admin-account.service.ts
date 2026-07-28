import { InvalidAdminSessionError } from '../errors/admin-session.errors';
import type {
  AdminAccount,
  AdminAccountRepository,
} from '../types/admin-session.types';

export class AdminAccountService {
  constructor(private readonly repository: AdminAccountRepository) {}

  async getCurrentAccount(adminId: string): Promise<AdminAccount> {
    const admin = await this.repository.findActivatedAccount(adminId);

    if (admin === undefined) {
      throw new InvalidAdminSessionError();
    }

    return admin;
  }
}
