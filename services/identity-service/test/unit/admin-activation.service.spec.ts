import { describe, expect, it } from 'vitest';

import type { AdminAuthJobPublisher } from '../../src/admins/ports/admin-auth-job.publisher';
import { AdminActivationService } from '../../src/admins/services/admin-activation.service';
import type {
  AdminActivationOtp,
  AdminActivationOtpRecord,
  AdminActivationOtpState,
  AdminActivationRepository,
} from '../../src/admins/types/admin-activation.types';
import type { PasswordHasher } from '../../src/security/types/password-hasher.types';

const ADMIN_ID = '8d6773a0-5ad9-4cba-9b3b-099e37d91655';
const HMAC_SECRET = 'unit-test-admin-activation-secret-32-characters';

class RecordingRepository implements AdminActivationRepository {
  account: { adminId: string } | undefined;
  activated: Array<{ adminId: string; passwordHash: string }> = [];
  confirmed: string[] = [];

  findAdminForActivation(): Promise<{ adminId: string } | undefined> {
    return Promise.resolve(this.account);
  }

  confirmEmail(adminId: string): Promise<boolean> {
    this.confirmed.push(adminId);
    return Promise.resolve(true);
  }

  activate(adminId: string, passwordHash: string): Promise<boolean> {
    this.activated.push({ adminId, passwordHash });
    return Promise.resolve(true);
  }
}

class RecordingState implements AdminActivationOtpState {
  canceled = 0;
  completed = 0;
  grant: { adminId: string; subject: string } | undefined;
  savedGrants = 0;
  savedOtps: AdminActivationOtpRecord[] = [];
  verification:
    | { status: 'invalid' }
    | { adminId: string; status: 'active' | 'confirmed' } = {
    status: 'invalid',
  };

  reserveRequest() {
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }

  save(record: AdminActivationOtpRecord): Promise<void> {
    this.savedOtps.push(record);
    return Promise.resolve();
  }

  cancel(): Promise<void> {
    this.canceled += 1;
    return Promise.resolve();
  }

  verify() {
    return Promise.resolve(this.verification);
  }

  saveGrant(): Promise<void> {
    this.savedGrants += 1;
    return Promise.resolve();
  }

  readGrant() {
    return Promise.resolve(this.grant);
  }

  completeGrant(): Promise<void> {
    this.completed += 1;
    return Promise.resolve();
  }
}

class RecordingPublisher implements Pick<
  AdminAuthJobPublisher,
  'publishActivation'
> {
  error: Error | undefined;
  otps: AdminActivationOtp[] = [];

  publishActivation(otp: AdminActivationOtp): Promise<void> {
    this.otps.push(otp);
    return this.error === undefined
      ? Promise.resolve()
      : Promise.reject(this.error);
  }
}

class TestPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return Promise.resolve(`hashed:${password}`);
  }
}

function createService() {
  const repository = new RecordingRepository();
  const state = new RecordingState();
  const publisher = new RecordingPublisher();
  return {
    publisher,
    repository,
    service: new AdminActivationService(
      repository,
      state,
      publisher,
      new TestPasswordHasher(),
      HMAC_SECRET,
    ),
    state,
  };
}

describe('admin activation', () => {
  it('sends activation only for a SQL-provisioned account while keeping the response generic', async () => {
    const { publisher, repository, service, state } = createService();

    await expect(service.register('missing@example.com')).resolves.toEqual({
      accepted: true,
    });
    expect(publisher.otps).toHaveLength(0);

    repository.account = { adminId: ADMIN_ID };
    await expect(service.register('  ADMIN@Example.COM ')).resolves.toEqual({
      accepted: true,
    });
    expect(publisher.otps[0]).toMatchObject({
      adminId: ADMIN_ID,
      email: 'admin@example.com',
    });
    expect(publisher.otps[0]?.otp).toMatch(/^\d{6}$/);
    expect(state.savedOtps[0]).toMatchObject({
      adminId: ADMIN_ID,
      attempts: 5,
      ttlMs: 15 * 60_000,
    });
  });

  it('activates the account with a confirmed OTP and password', async () => {
    const { repository, service, state } = createService();
    state.verification = { adminId: ADMIN_ID, status: 'active' };

    const confirmation = await service.confirm('admin@example.com', '123456');
    expect(confirmation.activationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repository.confirmed).toEqual([ADMIN_ID]);
    expect(state.savedGrants).toBe(1);

    state.grant = { adminId: ADMIN_ID, subject: 'protected-email' };
    await expect(
      service.complete(confirmation.activationToken, 'strong-password'),
    ).resolves.toEqual({ activated: true });
    expect(repository.activated).toEqual([
      { adminId: ADMIN_ID, passwordHash: 'hashed:strong-password' },
    ]);
    expect(state.completed).toBe(1);
  });
});
