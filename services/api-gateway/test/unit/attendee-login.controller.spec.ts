import { describe, expect, it } from 'vitest';

import { AttendeeLoginController } from '../../src/domains/attendees/controllers/attendee-login.controller';
import type { AttendeeLoginService } from '../../src/domains/attendees/services/attendee-login.service';
import { AttendeeSessionCookie } from '../../src/domains/attendees/services/attendee-session-cookie.service';

class RecordingLogin {
  login() {
    return Promise.resolve({
      attendeeId: 'attendee-1',
      email: 'attendee@example.com',
      emailVerified: true,
      sessionExpiresAt: '2026-08-03T12:00:00.000Z',
      sessionToken: 'opaque-token',
      status: 'active' as const,
      username: 'eventfan',
    });
  }
}

describe('AttendeeLoginController', () => {
  it('sets the opaque session cookie and omits the token from the body', async () => {
    const cookies: unknown[][] = [];
    const controller = new AttendeeLoginController(
      new RecordingLogin() as unknown as AttendeeLoginService,
      new AttendeeSessionCookie(true),
    );

    const result = await controller.login(
      {
        email: 'attendee@example.com',
        password: 'correct-password',
      },
      'request-42',
      {
        clearCookie: () => undefined,
        cookie: (...arguments_: unknown[]) => {
          cookies.push(arguments_);
        },
      },
    );

    expect(result).toEqual({
      attendeeId: 'attendee-1',
      email: 'attendee@example.com',
      emailVerified: true,
      status: 'active',
      username: 'eventfan',
    });
    expect(result).not.toHaveProperty('sessionToken');
    expect(cookies).toEqual([
      [
        'eventa_attendee_session',
        'opaque-token',
        {
          expires: new Date('2026-08-03T12:00:00.000Z'),
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: true,
        },
      ],
    ]);
  });
});
