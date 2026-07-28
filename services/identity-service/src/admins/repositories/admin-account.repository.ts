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

export class AdminAccountRepository
  implements AdminActivationRepository, AdminLoginRepository
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

  async confirmEmail(adminId: string): Promise<boolean> {
    return runWithOperationSpan(
      'admin_account.confirm_email',
      async () => {
        const [account] = await this.database
          .update(adminAccounts)
          .set({
            emailVerifiedAt: sql`COALESCE(${adminAccounts.emailVerifiedAt}, NOW())`,
          })
          .where(
            and(
              eq(adminAccounts.id, adminId),
              isNull(adminAccounts.passwordHash),
              isNull(adminAccounts.activatedAt),
            ),
          )
          .returning({ adminId: adminAccounts.id });

        return account !== undefined;
      },
      this.spanOptions('UPDATE'),
    );
  }

  async activate(adminId: string, passwordHash: string): Promise<boolean> {
    return runWithOperationSpan(
      'admin_account.activate',
      async () => {
        const [account] = await this.database
          .update(adminAccounts)
          .set({
            activatedAt: sql`NOW()`,
            passwordHash,
          })
          .where(
            and(
              eq(adminAccounts.id, adminId),
              isNotNull(adminAccounts.emailVerifiedAt),
              isNull(adminAccounts.passwordHash),
              isNull(adminAccounts.activatedAt),
            ),
          )
          .returning({ adminId: adminAccounts.id });

        return account !== undefined;
      },
      this.spanOptions('UPDATE'),
    );
  }

  findForLogin(email: string): Promise<AdminLoginAccount | undefined> {
    return runWithOperationSpan(
      'admin_account.find_for_login',
      async () => {
        const [account] = await this.database
          .select({
            activatedAt: adminAccounts.activatedAt,
            adminId: adminAccounts.id,
            email: adminAccounts.email,
            passwordHash: adminAccounts.passwordHash,
          })
          .from(adminAccounts)
          .where(eq(adminAccounts.email, email))
          .limit(1);

        return account === undefined
          ? undefined
          : {
              activated: account.activatedAt !== null,
              adminId: account.adminId,
              email: account.email,
              passwordHash: account.passwordHash,
            };
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
