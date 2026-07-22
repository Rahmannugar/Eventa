import { describe, expect, it } from 'vitest';

import type {
  AttendeeAccountWriter,
  CreateAttendeeAccount,
} from '../../src/attendees/types/attendee-account-write.types';
import {
  RegisterAttendeeCommand,
  type RegisteredAttendee,
} from '../../src/attendees/commands/register-attendee/register-attendee.command';
import { RegisterAttendeeCommandHandler } from '../../src/attendees/commands/register-attendee/register-attendee-command.handler';
import type { PasswordHasher } from '../../src/security/types/password-hasher.types';

class RecordingRepository implements AttendeeAccountWriter {
  received?: CreateAttendeeAccount;

  create(input: CreateAttendeeAccount): Promise<RegisteredAttendee> {
    this.received = input;

    return Promise.resolve({
      attendeeId: '60c75051-d63f-4b47-b815-fb3b81df44ae',
      email: input.email,
      username: input.username,
      emailVerified: false,
    });
  }
}

class DeterministicPasswordHasher implements PasswordHasher {
  received?: string;

  hash(password: string): Promise<string> {
    this.received = password;
    return Promise.resolve('$argon2id$test-hash');
  }
}

describe('RegisterAttendeeCommandHandler', () => {
  it('normalizes the email and username before creating the attendee', async () => {
    const repository = new RecordingRepository();
    const passwordHasher = new DeterministicPasswordHasher();
    const handler = new RegisterAttendeeCommandHandler(
      repository,
      passwordHasher,
    );

    await handler.handle(
      new RegisterAttendeeCommand(
        '  Attendee@Example.COM ',
        'a-secure-password',
        'EventFan',
      ),
    );

    expect(repository.received).toEqual({
      email: 'attendee@example.com',
      passwordHash: '$argon2id$test-hash',
      username: 'eventfan',
    });
  });

  it('hashes the password before creating the attendee', async () => {
    const repository = new RecordingRepository();
    const passwordHasher = new DeterministicPasswordHasher();
    const handler = new RegisterAttendeeCommandHandler(
      repository,
      passwordHasher,
    );

    await handler.handle(
      new RegisterAttendeeCommand(
        'attendee@example.com',
        'a-secure-password',
        'eventfan',
      ),
    );

    expect(passwordHasher.received).toBe('a-secure-password');
    expect(repository.received?.passwordHash).toBe('$argon2id$test-hash');
    expect(repository.received).not.toHaveProperty('password');
  });
});
