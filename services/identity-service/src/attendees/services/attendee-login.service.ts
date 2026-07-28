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

const INVALID_LOGIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$ZXZlbnRhLWxvZ2luLXNhbHQ$X1DCQPCT6hOJuXLJgazxWCP2S8h0TpQ2wFVxH4v5d1k';

export class AttendeeLoginService {
  constructor(
    private readonly repository: AttendeeLoginRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly sessions: AttendeeSessionService,
  ) {}

  async login(input: LoginAttendeeInput): Promise<LoggedInAttendee> {
    const email = input.email.trim().toLowerCase();
    const account = await this.repository.findForLogin(email);
    const passwordMatches = await this.passwordVerifier.verify(
      account?.passwordHash ?? INVALID_LOGIN_PASSWORD_HASH,
      input.password,
    );

    if (account === undefined || !passwordMatches) {
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
        throw new AttendeeAccountDeletedError();
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
