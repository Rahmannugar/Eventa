import type { PasswordVerifier } from '../../security/types/password-verifier.types';
import { InvalidAdminCredentialsError } from '../errors/admin-login.errors';
import { AdminSessionAccountBlockedError } from '../errors/admin-session.errors';
import type {
  AdminLoginRepository,
  LoggedInAdmin,
} from '../types/admin-login.types';
import type { AdminSessionIssuer } from '../types/admin-session.types';

export class AdminLoginService {
  constructor(
    private readonly repository: AdminLoginRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly sessions: AdminSessionIssuer,
  ) {}

  async login(email: string, password: string): Promise<LoggedInAdmin> {
    const canonicalEmail = email.trim().toLowerCase();
    const account = await this.repository.findActivatedForLogin(canonicalEmail);

    if (account === undefined) {
      throw new InvalidAdminCredentialsError();
    }

    const passwordMatches = await this.passwordVerifier.verify(
      account.passwordHash,
      password,
    );

    if (!passwordMatches) {
      throw new InvalidAdminCredentialsError();
    }

    let session;

    try {
      session = await this.sessions.issue(account.adminId);
    } catch (error: unknown) {
      if (error instanceof AdminSessionAccountBlockedError) {
        throw new InvalidAdminCredentialsError();
      }

      throw error;
    }

    return {
      adminId: account.adminId,
      email: account.email,
      sessionExpiresAt: session.expiresAt.toISOString(),
      sessionToken: session.token,
    };
  }
}
