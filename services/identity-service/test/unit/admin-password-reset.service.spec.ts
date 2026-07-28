import { describe, expect, it } from 'vitest';

import { AdminPasswordResetService } from '../../src/admins/services/admin-password-reset.service';
import type { AdminPasswordResetRepository } from '../../src/admins/types/admin-password-reset.types';
import type { AdminAuthJobPublisher } from '../../src/admins/ports/admin-auth-job.publisher';
import type { PasswordHasher } from '../../src/security/types/password-hasher.types';
import type { PasswordResetCodeState } from '../../src/security/ports/password-reset-code.state';
import type { PasswordResetClaim } from '../../src/security/types/password-reset-state.types';

class ResetState implements PasswordResetCodeState {
  claims: PasswordResetClaim[] = [];

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  claim(): Promise<PasswordResetClaim> {
    return Promise.resolve(this.claims.shift() ?? { status: 'invalid' });
  }

  markCompleted(): Promise<void> {
    return Promise.resolve();
  }

  releaseClaim(): Promise<void> {
    return Promise.resolve();
  }

  reserve(): Promise<{ allowed: true; retryAfterSeconds: 0 }> {
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }

  save(): Promise<void> {
    return Promise.resolve();
  }
}

describe('admin password reset', () => {
  it('revokes every session before replacing the password', async () => {
    const events: string[] = [];
    const state = new ResetState();
    state.claims = [
      { accountId: 'admin-1', resetId: 'reset-1', status: 'claimed' },
      { accountId: 'admin-1', resetId: 'reset-1', status: 'completed' },
    ];
    const repository: AdminPasswordResetRepository = {
      completedPasswordReset: () => Promise.resolve(false),
      findActivatedForPasswordReset: () => Promise.resolve(undefined),
      replacePassword: () => {
        events.push('password-replaced');
        return Promise.resolve(true);
      },
    };
    const publisher: Pick<AdminAuthJobPublisher, 'publishPasswordReset'> = {
      publishPasswordReset: () => Promise.resolve(),
    };
    const hasher: PasswordHasher = {
      hash: () => {
        events.push('password-hashed');
        return Promise.resolve('replacement-hash');
      },
    };
    const sessions = {
      cancelPasswordReset: () => Promise.resolve(),
      startPasswordReset: () => {
        events.push('sessions-blocked-and-revoked');
        return Promise.resolve(3);
      },
    };
    const service = new AdminPasswordResetService(
      repository,
      state,
      publisher,
      hasher,
      sessions,
      'admin-auth-secret-at-least-32-characters',
    );

    await service.resetPassword(
      'admin@example.com',
      '123456',
      'replacement-password',
    );
    await service.resetPassword(
      'admin@example.com',
      '123456',
      'replacement-password',
    );

    expect(events).toEqual([
      'sessions-blocked-and-revoked',
      'password-hashed',
      'password-replaced',
    ]);
  });
});
