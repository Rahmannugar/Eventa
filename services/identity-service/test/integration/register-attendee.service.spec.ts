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
import { AttendeeRegistrationRepository } from '../../src/attendees/repositories/attendee-registration.repository';
import {
  attendeeAccounts,
  attendeeProfiles,
} from '../../src/attendees/schema/attendee.schema';
import { RegisterAttendeeService } from '../../src/attendees/services/register-attendee.service';
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
const repository = new AttendeeRegistrationRepository(database);
const service = new RegisterAttendeeService(
  repository,
  new Argon2PasswordHasher(),
);

describe('RegisterAttendeeService integration', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
  });

  beforeEach(async () => {
    await database.delete(attendeeProfiles);
    await database.delete(attendeeAccounts);
  });

  afterAll(async () => {
    await client.end();
  });

  it('registers an attendee with normalized identity fields and a secure password hash', async () => {
    const registration = await service.register({
      email: '  Attendee@Example.COM ',
      password: 'a-secure-password',
      username: 'EventFan',
    });

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
        username: attendeeProfiles.username,
      })
      .from(attendeeAccounts)
      .innerJoin(
        attendeeProfiles,
        eq(attendeeProfiles.attendeeId, attendeeAccounts.id),
      );

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
    await service.register({
      email: 'attendee@example.com',
      password: 'first-secure-password',
      username: 'first_user',
    });

    await expect(
      service.register({
        email: 'ATTENDEE@example.com',
        password: 'second-secure-password',
        username: 'second_user',
      }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('rolls back the new account when the username is already taken', async () => {
    await service.register({
      email: 'first@example.com',
      password: 'first-secure-password',
      username: 'eventfan',
    });

    await expect(
      service.register({
        email: 'rolled-back@example.com',
        password: 'second-secure-password',
        username: 'EventFan',
      }),
    ).rejects.toBeInstanceOf(UsernameUnavailableError);

    const [rolledBackAccountCount] = await database
      .select({ value: count() })
      .from(attendeeAccounts)
      .where(eq(attendeeAccounts.email, 'rolled-back@example.com'));

    expect(rolledBackAccountCount?.value).toBe(0);
  });

  it('allows only one concurrent registration for the same email', async () => {
    const attempts = await Promise.allSettled([
      service.register({
        email: 'race@example.com',
        password: 'first-secure-password',
        username: 'race_one',
      }),
      service.register({
        email: 'RACE@example.com',
        password: 'second-secure-password',
        username: 'race_two',
      }),
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
});
