import type { PasswordVerifier } from '../../security/types/password-verifier.types';
import { InvalidAdminCredentialsError } from '../errors/admin-login.errors';
import type {
  AdminLoginRepository,
  AdminSessionIssuer,
  LoggedInAdmin,
} from '../types/admin-login.types';

const INVALID_LOGIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$ZXZlbnRhLWxvZ2luLXNhbHQ$X1DCQPCT6hOJuXLJgazxWCP2S8h0TpQ2wFVxH4v5d1k';

export class AdminLoginService {
  constructor(
    private readonly repository: AdminLoginRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly sessions: AdminSessionIssuer,
  ) {}

  async login(email: string, password: string): Promise<LoggedInAdmin> {
    const canonicalEmail = email.trim().toLowerCase();
    const account = await this.repository.findForLogin(canonicalEmail);
    const passwordMatches = await this.passwordVerifier.verify(
      account?.passwordHash ?? INVALID_LOGIN_PASSWORD_HASH,
      password,
    );

    if (
      account === undefined ||
      !account.activated ||
      account.passwordHash === null ||
      !passwordMatches
    ) {
      throw new InvalidAdminCredentialsError();
    }

    const session = await this.sessions.issue(account.adminId);

    return {
      adminId: account.adminId,
      email: account.email,
      sessionExpiresAt: session.expiresAt.toISOString(),
      sessionToken: session.token,
    };
  }
}
