import { Inject } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { IDENTITY_DATABASE } from '../../database/database.constants';
import type { IdentityDatabase } from '../../database/database.types';
import { adminAccounts } from '../schema/admin.schema';
import type {
  AdminActivationAccount,
  AdminActivationRepository,
} from '../types/admin-activation.types';
import type {
  AdminLoginAccount,
  AdminLoginRepository,
} from '../types/admin-login.types';
import type {
  AdminAccount,
  AdminAccountRepository as AdminAccountReader,
} from '../types/admin-session.types';
import type {
  AdminPasswordResetAccount,
  AdminPasswordResetRepository,
} from '../types/admin-password-reset.types';

export class AdminAccountRepository
  implements
    AdminActivationRepository,
    AdminLoginRepository,
    AdminAccountReader,
    AdminPasswordResetRepository
{
  constructor(
    @Inject(IDENTITY_DATABASE)
    private readonly database: IdentityDatabase,
  ) {}

  async findAdminForActivation(
    email: string,
  ): Promise<AdminActivationAccount | undefined> {
    return runWithOperationSpan(
      'admin_account.find_for_activation',
      async () => {
        const [account] = await this.database
          .select({ adminId: adminAccounts.id })
          .from(adminAccounts)
          .where(
            and(
              eq(adminAccounts.email, email),
              isNull(adminAccounts.passwordHash),
              isNull(adminAccounts.activatedAt),
            ),
          )
          .limit(1);

        return account;
      },
      this.spanOptions('SELECT'),
    );
  }

  async activate(
    adminId: string,
    passwordHash: string,
  ): Promise<'activated' | 'already-activated' | 'invalid'> {
    return runWithOperationSpan(
      'admin_account.activate',
      async () => {
        const [account] = await this.database
          .update(adminAccounts)
          .set({
            activatedAt: sql`NOW()`,
            emailVerifiedAt: sql`NOW()`,
            passwordHash,
          })
          .where(
            and(
              eq(adminAccounts.id, adminId),
              isNull(adminAccounts.passwordHash),
              isNull(adminAccounts.activatedAt),
            ),
          )
          .returning({ adminId: adminAccounts.id });

        if (account !== undefined) {
          return 'activated';
        }

        const [existing] = await this.database
          .select({ adminId: adminAccounts.id })
          .from(adminAccounts)
          .where(
            and(
              eq(adminAccounts.id, adminId),
              isNotNull(adminAccounts.emailVerifiedAt),
              isNotNull(adminAccounts.passwordHash),
              isNotNull(adminAccounts.activatedAt),
            ),
          )
          .limit(1);

        return existing === undefined ? 'invalid' : 'already-activated';
      },
      this.spanOptions('UPDATE'),
    );
  }

  findActivatedForLogin(email: string): Promise<AdminLoginAccount | undefined> {
    return runWithOperationSpan(
      'admin_account.find_activated_for_login',
      async () => {
        const [account] = await this.database
          .select({
            adminId: adminAccounts.id,
            email: adminAccounts.email,
            passwordHash: sql<string>`${adminAccounts.passwordHash}`,
          })
          .from(adminAccounts)
          .where(
            and(
              eq(adminAccounts.email, email),
              isNotNull(adminAccounts.emailVerifiedAt),
              isNotNull(adminAccounts.passwordHash),
              isNotNull(adminAccounts.activatedAt),
            ),
          )
          .limit(1);

        return account === undefined
          ? undefined
          : {
              adminId: account.adminId,
              email: account.email,
              passwordHash: account.passwordHash,
            };
      },
      this.spanOptions('SELECT'),
    );
  }

  findActivatedAccount(adminId: string): Promise<AdminAccount | undefined> {
    return runWithOperationSpan(
      'admin_account.find_activated',
      async () => {
        const [account] = await this.database
          .select({
            adminId: adminAccounts.id,
            email: adminAccounts.email,
          })
          .from(adminAccounts)
          .where(
            and(
              eq(adminAccounts.id, adminId),
              isNotNull(adminAccounts.emailVerifiedAt),
              isNotNull(adminAccounts.passwordHash),
              isNotNull(adminAccounts.activatedAt),
            ),
          )
          .limit(1);

        return account;
      },
      this.spanOptions('SELECT'),
    );
  }

  findActivatedForPasswordReset(
    email: string,
  ): Promise<AdminPasswordResetAccount | undefined> {
    return runWithOperationSpan(
      'admin_account.find_activated_for_password_reset',
      async () => {
        const [account] = await this.database
          .select({
            adminId: adminAccounts.id,
            email: adminAccounts.email,
          })
          .from(adminAccounts)
          .where(
            and(
              eq(adminAccounts.email, email),
              isNotNull(adminAccounts.emailVerifiedAt),
              isNotNull(adminAccounts.passwordHash),
              isNotNull(adminAccounts.activatedAt),
            ),
          )
          .limit(1);

        return account;
      },
      this.spanOptions('SELECT'),
    );
  }

  async replacePassword(
    adminId: string,
    passwordHash: string,
    resetId: string,
  ): Promise<boolean> {
    return runWithOperationSpan(
      'admin_account.replace_password',
      async () => {
        const [account] = await this.database
          .update(adminAccounts)
          .set({ passwordHash, passwordResetId: resetId })
          .where(
            and(
              eq(adminAccounts.id, adminId),
              isNotNull(adminAccounts.emailVerifiedAt),
              isNotNull(adminAccounts.passwordHash),
              isNotNull(adminAccounts.activatedAt),
            ),
          )
          .returning({ adminId: adminAccounts.id });

        return account !== undefined;
      },
      this.spanOptions('UPDATE'),
    );
  }

  completedPasswordReset(adminId: string, resetId: string): Promise<boolean> {
    return runWithOperationSpan(
      'admin_account.password_reset_completed',
      async () => {
        const [account] = await this.database
          .select({ adminId: adminAccounts.id })
          .from(adminAccounts)
          .where(
            and(
              eq(adminAccounts.id, adminId),
              eq(adminAccounts.passwordResetId, resetId),
            ),
          )
          .limit(1);

        return account !== undefined;
      },
      this.spanOptions('SELECT'),
    );
  }

  private spanOptions(operation: string): {
    attributes: Record<string, string>;
    kind: 'client';
  } {
    return {
      attributes: {
        'db.collection.name': 'admin_accounts',
        'db.namespace': 'eventa_identity',
        'db.operation.name': operation,
        'db.system.name': 'postgresql',
      },
      kind: 'client',
    };
  }
}
