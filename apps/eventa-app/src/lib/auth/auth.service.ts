import { z } from 'zod';

import { apiCommand, apiRequest } from '../api/api-client';
import type { Actor, LoginInput, SessionAccount } from './auth.types';

const attendeeAccountSchema = z
  .object({
    attendeeId: z.uuid(),
    email: z.email(),
    emailVerified: z.literal(true),
    status: z.literal('active'),
    username: z.string().min(1),
  })
  .transform((account) => ({ ...account, actor: 'attendee' as const }));

const adminAccountSchema = z
  .object({
    adminId: z.uuid(),
    email: z.email(),
  })
  .transform((account) => ({ ...account, actor: 'admin' as const }));

const endpoints = {
  admin: '/auth/admins',
  attendee: '/auth/attendees',
} as const;

export function getCurrentAccount(actor: Actor): Promise<SessionAccount> {
  return actor === 'attendee'
    ? apiRequest(`${endpoints.attendee}/me`, {
        responseSchema: attendeeAccountSchema,
      })
    : apiRequest(`${endpoints.admin}/me`, {
        responseSchema: adminAccountSchema,
      });
}

export function login(
  actor: Actor,
  input: LoginInput,
): Promise<SessionAccount> {
  return actor === 'attendee'
    ? apiRequest(`${endpoints.attendee}/login`, {
        body: input,
        method: 'POST',
        responseSchema: attendeeAccountSchema,
      })
    : apiRequest(`${endpoints.admin}/login`, {
        body: input,
        method: 'POST',
        responseSchema: adminAccountSchema,
      });
}

export function logout(actor: Actor): Promise<void> {
  return apiCommand(`${endpoints[actor]}/logout`, { method: 'POST' });
}
