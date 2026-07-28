import { describe, expect, it } from 'vitest';

import { AttendeeDeletionService } from '../../src/attendees/services/attendee-deletion.service';
import type {
  AttendeeDeletionRepository,
  AttendeeDeletionSessions,
} from '../../src/attendees/types/attendee-deletion.types';
import type { PasswordVerifier } from '../../src/security/types/password-verifier.types';

function deletionFlow(options?: { databaseFails?: boolean }) {
  const events: string[] = [];
  const repository: AttendeeDeletionRepository = {
    findAccountForDeletion: () =>
      Promise.resolve({
        attendeeId: '4f2e9bf0-4c37-4ada-a9a7-13e1287e3655',
        passwordHash: 'stored-hash',
      }),
    deleteAccount: () => {
      events.push('account-deleted');
      return options?.databaseFails
        ? Promise.reject(new Error('database unavailable'))
        : Promise.resolve({
            attendeeId: '4f2e9bf0-4c37-4ada-a9a7-13e1287e3655',
            deletedAt: '2026-07-28T08:00:00.000Z',
            eventId: 'e58ee98a-c61a-454d-a19a-2dedf335f937',
            type: 'attendee.deleted.v1',
          });
    },
  };
  const passwordVerifier: PasswordVerifier = {
    verify: () => Promise.resolve(true),
  };
  const sessions: AttendeeDeletionSessions = {
    prepareAccountDeletion: () => {
      events.push('sessions-blocked-and-revoked');
      return Promise.resolve(2);
    },
    completeAccountDeletion: () => {
      events.push('deletion-barrier-completed');
      return Promise.resolve();
    },
    cancelAccountDeletion: () => {
      events.push('deletion-barrier-cancelled');
      return Promise.resolve();
    },
  };

  return {
    events,
    service: new AttendeeDeletionService(
      repository,
      passwordVerifier,
      sessions,
    ),
  };
}

describe('AttendeeDeletionService', () => {
  it('blocks sessions before deleting the account and retains the barrier afterward', async () => {
    const { events, service } = deletionFlow();

    await expect(
      service.deleteAccount(
        '4f2e9bf0-4c37-4ada-a9a7-13e1287e3655',
        'correct-password',
      ),
    ).resolves.toBeUndefined();
    expect(events).toEqual([
      'sessions-blocked-and-revoked',
      'account-deleted',
      'deletion-barrier-completed',
    ]);
  });

  it('releases the temporary barrier when the database cannot delete the account', async () => {
    const { events, service } = deletionFlow({ databaseFails: true });

    await expect(
      service.deleteAccount(
        '4f2e9bf0-4c37-4ada-a9a7-13e1287e3655',
        'correct-password',
      ),
    ).rejects.toThrow('database unavailable');
    expect(events).toEqual([
      'sessions-blocked-and-revoked',
      'account-deleted',
      'deletion-barrier-cancelled',
    ]);
  });
});
