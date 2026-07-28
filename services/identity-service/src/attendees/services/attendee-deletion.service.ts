import type { PasswordVerifier } from '../../security/types/password-verifier.types';
import {
  ATTENDEE_DELETION_BARRIER_TTL_MS,
  ATTENDEE_DELETION_PREPARATION_TTL_MS,
} from '../constants/attendee-deletion.constants';
import { AttendeeDeletionPasswordInvalidError } from '../errors/attendee-deletion.errors';
import { InvalidAttendeeSessionError } from '../errors/attendee-session.errors';
import { AttendeeSessionAccountBlockedError } from '../errors/attendee-session.errors';
import type {
  AttendeeDeletionRepository,
  AttendeeDeletionSessions,
} from '../types/attendee-deletion.types';

export class AttendeeDeletionService {
  constructor(
    private readonly repository: AttendeeDeletionRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly sessions: AttendeeDeletionSessions,
  ) {}

  async deleteAccount(attendeeId: string, password: string): Promise<void> {
    const account = await this.repository.findAccountForDeletion(attendeeId);

    if (account === undefined) {
      throw new InvalidAttendeeSessionError();
    }

    if (!(await this.passwordVerifier.verify(account.passwordHash, password))) {
      throw new AttendeeDeletionPasswordInvalidError();
    }

    try {
      await this.sessions.prepareAccountDeletion(
        attendeeId,
        ATTENDEE_DELETION_PREPARATION_TTL_MS,
      );
    } catch (error: unknown) {
      if (error instanceof AttendeeSessionAccountBlockedError) {
        throw new InvalidAttendeeSessionError();
      }

      throw error;
    }

    try {
      const deleted = await this.repository.deleteAccount(attendeeId);

      if (deleted === undefined) {
        throw new InvalidAttendeeSessionError();
      }
    } catch (error: unknown) {
      try {
        await this.sessions.cancelAccountDeletion(attendeeId);
      } catch {
        // The short preparation TTL provides bounded recovery if Redis is unavailable.
      }

      throw error;
    }

    try {
      await this.sessions.completeAccountDeletion(
        attendeeId,
        ATTENDEE_DELETION_BARRIER_TTL_MS,
      );
    } catch {
      // PostgreSQL now rejects login and the preparation barrier expires safely.
    }
  }
}
