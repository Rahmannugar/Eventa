import { resolve } from 'node:path';

import { verify } from 'argon2';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../../src/attendees/errors/attendee-registration.errors';
import { PostgresAttendeeAccountRepository } from '../../src/attendees/repositories/attendee-account.repository';
import { attendeeAccounts } from '../../src/attendees/schema/attendee.schema';
import type { RegisterAttendeeInput } from '../../src/attendees/types/attendee-registration.types';
import { AttendeeRegistrationService } from '../../src/attendees/services/attendee-registration.service';
import { Argon2PasswordHasher } from '../../src/security/services/argon2-password-hasher.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === '') {
  throw new Error('TEST_DATABASE_URL is required for integration tests');
}

const requiredTestDatabaseUrl = testDatabaseUrl;
const testDatabaseName = new URL(requiredTestDatabaseUrl).pathname.slice(1);

if (!/^[a-z][a-z0-9_]*_test$/.test(testDatabaseName)) {
  throw new Error('TEST_DATABASE_URL must target a database ending in _test');
}

async function ensureTestDatabase(): Promise<void> {
  const adminUrl = new URL(requiredTestDatabaseUrl);
  adminUrl.pathname = '/postgres';
  const adminClient = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    const [databaseState] = await adminClient<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_database
        WHERE datname = ${testDatabaseName}
      ) AS exists
    `;

    if (databaseState?.exists !== true) {
      await adminClient.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    }
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      Reflect.get(error, 'code') !== '42P04'
    ) {
      throw error;
    }
  } finally {
    await adminClient.end();
  }
}

const client = postgres(requiredTestDatabaseUrl, {
  max: 5,
  onnotice: () => undefined,
});
const database = drizzle(client);
const repository = new PostgresAttendeeAccountRepository(database);
const service = new AttendeeRegistrationService(
  repository,
  new Argon2PasswordHasher(),
  {
    start: () => Promise.resolve(),
  },
);

function registrationInput(
  email: string,
  password: string,
  username: string,
): RegisterAttendeeInput {
  return { email, password, username };
}

describe('AttendeeRegistrationService integration', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(attendeeAccounts);
  });

  afterAll(async () => {
    await client.end();
  });

  it('registers an attendee with normalized identity fields and a secure password hash', async () => {
    const registration = await service.register(
      registrationInput(
        '  Attendee@Example.COM ',
        'a-secure-password',
        'EventFan',
      ),
    );

    expect(registration).toMatchObject({
      email: 'attendee@example.com',
      username: 'eventfan',
      emailVerified: false,
    });

    const [persisted] = await database
      .select({
        attendeeId: attendeeAccounts.id,
        email: attendeeAccounts.email,
        passwordHash: attendeeAccounts.passwordHash,
        username: attendeeAccounts.username,
      })
      .from(attendeeAccounts);

    expect(persisted).toMatchObject({
      attendeeId: registration.attendeeId,
      email: 'attendee@example.com',
      username: 'eventfan',
    });
    expect(persisted?.passwordHash).not.toBe('a-secure-password');
    await expect(
      verify(persisted?.passwordHash ?? '', 'a-secure-password'),
    ).resolves.toBe(true);
  });

  it('rejects another registration using the same email', async () => {
    await service.register(
      registrationInput(
        'attendee@example.com',
        'first-secure-password',
        'first_user',
      ),
    );

    await expect(
      service.register(
        registrationInput(
          'ATTENDEE@example.com',
          'second-secure-password',
          'second_user',
        ),
      ),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('rejects another registration using the same username', async () => {
    await service.register(
      registrationInput(
        'first@example.com',
        'first-secure-password',
        'eventfan',
      ),
    );

    await expect(
      service.register(
        registrationInput(
          'second@example.com',
          'second-secure-password',
          'EventFan',
        ),
      ),
    ).rejects.toBeInstanceOf(UsernameUnavailableError);

    const [rejectedAccountCount] = await database
      .select({ value: count() })
      .from(attendeeAccounts)
      .where(eq(attendeeAccounts.email, 'second@example.com'));

    expect(rejectedAccountCount?.value).toBe(0);
  });

  it('allows only one concurrent registration for the same email', async () => {
    const attempts = await Promise.allSettled([
      service.register(
        registrationInput(
          'race@example.com',
          'first-secure-password',
          'race_one',
        ),
      ),
      service.register(
        registrationInput(
          'RACE@example.com',
          'second-secure-password',
          'race_two',
        ),
      ),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);

    const [accountCount] = await database
      .select({ value: count() })
      .from(attendeeAccounts)
      .where(eq(attendeeAccounts.email, 'race@example.com'));

    expect(accountCount?.value).toBe(1);
  });

  it('marks email verification idempotently without changing the original timestamp', async () => {
    const registration = await service.register(
      registrationInput(
        'verify@example.com',
        'verification-password',
        'verify_user',
      ),
    );

    await expect(repository.findByEmail('verify@example.com')).resolves.toEqual(
      {
        attendeeId: registration.attendeeId,
        emailVerified: false,
      },
    );
    await expect(
      repository.markEmailVerified(registration.attendeeId),
    ).resolves.toBe(true);

    const [firstUpdate] = await database
      .select({ emailVerifiedAt: attendeeAccounts.emailVerifiedAt })
      .from(attendeeAccounts)
      .where(eq(attendeeAccounts.id, registration.attendeeId));

    await expect(
      repository.markEmailVerified(registration.attendeeId),
    ).resolves.toBe(true);

    const [secondUpdate] = await database
      .select({ emailVerifiedAt: attendeeAccounts.emailVerifiedAt })
      .from(attendeeAccounts)
      .where(eq(attendeeAccounts.id, registration.attendeeId));

    expect(firstUpdate?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(secondUpdate?.emailVerifiedAt).toEqual(firstUpdate?.emailVerifiedAt);
    await expect(repository.findByEmail('verify@example.com')).resolves.toEqual(
      {
        attendeeId: registration.attendeeId,
        emailVerified: true,
      },
    );
  });
});
