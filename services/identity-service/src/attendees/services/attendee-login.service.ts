import {
  AttendeeAccountDeletedError,
  AttendeeAccountSuspendedError,
  AttendeeEmailVerificationRequiredError,
  InvalidAttendeeCredentialsError,
} from '../errors/attendee-login.errors';
import type { PasswordVerifier } from '../../security/types/password-verifier.types';
import type {
  AttendeeLoginRepository,
  LoggedInAttendee,
  LoginAttendeeInput,
} from '../types/attendee-login.types';
import type { AttendeeSessionService } from './attendee-session.service';
import { AttendeeSessionAccountBlockedError } from '../errors/attendee-session.errors';

export class AttendeeLoginService {
  constructor(
    private readonly repository: AttendeeLoginRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly sessions: AttendeeSessionService,
  ) {}

  async login(input: LoginAttendeeInput): Promise<LoggedInAttendee> {
    const email = input.email.trim().toLowerCase();
    const account = await this.repository.findForLogin(email);

    if (account === undefined) {
      throw new InvalidAttendeeCredentialsError();
    }

    const passwordMatches = await this.passwordVerifier.verify(
      account.passwordHash,
      input.password,
    );

    if (!passwordMatches) {
      throw new InvalidAttendeeCredentialsError();
    }

    if (account.deletedAt !== null) {
      throw new AttendeeAccountDeletedError();
    }

    if (account.status === 'suspended') {
      throw new AttendeeAccountSuspendedError();
    }

    if (!account.emailVerified) {
      throw new AttendeeEmailVerificationRequiredError();
    }

    let session;

    try {
      session = await this.sessions.issue(account.attendeeId);
    } catch (error: unknown) {
      if (error instanceof AttendeeSessionAccountBlockedError) {
        switch (error.reason) {
          case 'account-deletion':
            throw new AttendeeAccountDeletedError();
          case 'password-reset':
            throw new InvalidAttendeeCredentialsError();
        }
      }

      throw error;
    }

    return {
      attendeeId: account.attendeeId,
      email: account.email,
      emailVerified: true,
      sessionExpiresAt: session.expiresAt.toISOString(),
      sessionToken: session.token,
      status: 'active',
      username: account.username,
    };
  }
}
