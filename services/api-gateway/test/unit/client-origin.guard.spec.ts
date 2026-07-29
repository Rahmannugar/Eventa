import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AdminClientOriginGuard } from '../../src/domains/admins/guards/admin-client-origin.guard';
import { AttendeeClientOriginGuard } from '../../src/domains/attendees/guards/attendee-client-origin.guard';

function requestWith(origin?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { origin } }),
    }),
  } as unknown as ExecutionContext;
}

const guards: CanActivate[] = [
  new AdminClientOriginGuard('http://localhost:5274'),
  new AttendeeClientOriginGuard('http://localhost:5273'),
];

describe('client origin guards', () => {
  it('allows non-browser clients without an origin', () => {
    for (const guard of guards) {
      expect(guard.canActivate(requestWith())).toBe(true);
    }
  });

  it('rejects another browser origin', () => {
    for (const guard of guards) {
      expect(() =>
        guard.canActivate(requestWith('https://untrusted.example')),
      ).toThrow('Request origin is not allowed.');
    }
  });
});
