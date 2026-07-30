import { allowIf, createRail, requireAuth } from 'authrail';

import type { Actor, SessionAccount } from './auth.types';

export interface AuthRailContext {
  user: SessionAccount | null;
}

export const attendeeRail = createRail<AuthRailContext>('attendee-routes', [
  requireAuth('/attendee/login'),
  allowIf((context) => context.user?.actor === 'attendee'),
]);

export const adminRail = createRail<AuthRailContext>('admin-routes', [
  requireAuth('/admin/login'),
  allowIf((context) => context.user?.actor === 'admin'),
]);

export function authRail(actor: Actor) {
  return actor === 'attendee' ? attendeeRail : adminRail;
}
