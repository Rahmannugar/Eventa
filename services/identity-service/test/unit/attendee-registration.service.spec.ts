import { describe, expect, it } from 'vitest';

import type {
  AttendeeAccountRepository,
  CreateAttendeeAccount,
} from '../../src/attendees/types/attendee-account-repository.types';
import type { RegisteredAttendee } from '../../src/attendees/types/attendee-registration.types';
import { AttendeeRegistrationService } from '../../src/attendees/services/attendee-registration.service';
import type { AttendeeRegistrationEmailVerification } from '../../src/attendees/types/attendee-email-verification.types';
import type { PasswordHasher } from '../../src/security/types/password-hasher.types';

class RecordingRepository implements AttendeeAccountRepository {
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

class RecordingEmailVerification implements AttendeeRegistrationEmailVerification {
  starts: Array<{ attendeeId: string; email: string }> = [];

  start(attendeeId: string, email: string): Promise<void> {
    this.starts.push({ attendeeId, email });
    return Promise.resolve();
  }
}

describe('AttendeeRegistrationService', () => {
  it('normalizes the email and username before creating the attendee', async () => {
    const repository = new RecordingRepository();
    const passwordHasher = new DeterministicPasswordHasher();
    const emailVerification = new RecordingEmailVerification();
    const service = new AttendeeRegistrationService(
      repository,
      passwordHasher,
      emailVerification,
    );

    await service.register({
      email: '  Attendee@Example.COM ',
      password: 'a-secure-password',
      username: 'EventFan',
    });

    expect(repository.received).toEqual({
      email: 'attendee@example.com',
      passwordHash: '$argon2id$test-hash',
      username: 'eventfan',
    });
    expect(emailVerification.starts).toEqual([
      {
        attendeeId: '60c75051-d63f-4b47-b815-fb3b81df44ae',
        email: 'attendee@example.com',
      },
    ]);
  });

  it('hashes the password before creating the attendee', async () => {
    const repository = new RecordingRepository();
    const passwordHasher = new DeterministicPasswordHasher();
    const service = new AttendeeRegistrationService(
      repository,
      passwordHasher,
      new RecordingEmailVerification(),
    );

    await service.register({
      email: 'attendee@example.com',
      password: 'a-secure-password',
      username: 'eventfan',
    });

    expect(passwordHasher.received).toBe('a-secure-password');
    expect(repository.received?.passwordHash).toBe('$argon2id$test-hash');
    expect(repository.received).not.toHaveProperty('password');
  });
});
