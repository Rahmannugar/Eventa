import { describe, expect, it } from 'vitest';

import { InvalidAdminCredentialsError } from '../../src/admins/errors/admin-login.errors';
import { AdminLoginService } from '../../src/admins/services/admin-login.service';
import type {
  AdminLoginAccount,
  AdminLoginRepository,
} from '../../src/admins/types/admin-login.types';
import type { PasswordVerifier } from '../../src/security/types/password-verifier.types';

const ADMIN_ID = '8d6773a0-5ad9-4cba-9b3b-099e37d91655';

class LoginRepository implements AdminLoginRepository {
  account: AdminLoginAccount | undefined;

  findActivatedForLogin(): Promise<AdminLoginAccount | undefined> {
    return Promise.resolve(this.account);
  }
}

class PasswordCheck implements PasswordVerifier {
  checkedHashes: string[] = [];

  verify(hash: string, password: string): Promise<boolean> {
    this.checkedHashes.push(hash);
    return Promise.resolve(hash === 'valid-hash' && password === 'password-1');
  }
}

class Sessions {
  issued: string[] = [];

  issue(adminId: string) {
    this.issued.push(adminId);
    return Promise.resolve({
      adminId,
      expiresAt: new Date('2026-08-04T12:00:00.000Z'),
      sessionId: 'session-1',
      token: 'a'.repeat(43),
    });
  }
}

function setup() {
  const repository = new LoginRepository();
  const passwordCheck = new PasswordCheck();
  const sessions = new Sessions();
  return {
    passwordCheck,
    repository,
    service: new AdminLoginService(repository, passwordCheck, sessions),
    sessions,
  };
}

describe('admin login', () => {
  it('creates a seven-day session only after activated credentials match', async () => {
    const { repository, service, sessions } = setup();
    repository.account = {
      adminId: ADMIN_ID,
      email: 'admin@example.com',
      passwordHash: 'valid-hash',
    };

    await expect(
      service.login(' ADMIN@Example.COM ', 'password-1'),
    ).resolves.toEqual({
      adminId: ADMIN_ID,
      email: 'admin@example.com',
      sessionExpiresAt: '2026-08-04T12:00:00.000Z',
      sessionToken: 'a'.repeat(43),
    });
    expect(sessions.issued).toEqual([ADMIN_ID]);
  });

  it('rejects an unavailable account without creating a session', async () => {
    const { service, sessions } = setup();

    await expect(
      service.login('missing@example.com', 'password-1'),
    ).rejects.toBeInstanceOf(InvalidAdminCredentialsError);
    expect(sessions.issued).toHaveLength(0);
  });
});
