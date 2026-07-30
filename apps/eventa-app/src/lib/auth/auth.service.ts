import { z } from 'zod';

import { apiCommand, apiRequest } from '../api/api-client';
import type {
  Actor,
  ActivateAdminInput,
  ConfirmAttendeeEmailInput,
  LoginInput,
  RegisterAttendeeInput,
  RegisteredAttendee,
  RequestAdminActivationInput,
  ResendAttendeeEmailInput,
  SessionAccount,
} from './auth.types';

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

const registeredAttendeeSchema = z.object({
  attendeeId: z.uuid(),
  email: z.email(),
  emailVerified: z.literal(false),
  username: z.string().min(1),
});

const attendeeEmailVerifiedSchema = z.object({
  emailVerified: z.literal(true),
});

const attendeeEmailResendAcceptedSchema = z.object({
  accepted: z.literal(true),
});

const adminActivationRequestedSchema = z.object({
  accepted: z.literal(true),
});

const adminActivatedSchema = z.object({
  activated: z.literal(true),
});

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

export function registerAttendee(
  input: RegisterAttendeeInput,
): Promise<RegisteredAttendee> {
  return apiRequest(`${endpoints.attendee}/register`, {
    body: input,
    method: 'POST',
    responseSchema: registeredAttendeeSchema,
  });
}

export async function confirmAttendeeEmail(
  input: ConfirmAttendeeEmailInput,
): Promise<void> {
  await apiRequest(`${endpoints.attendee}/email-verification/confirm`, {
    body: input,
    method: 'POST',
    responseSchema: attendeeEmailVerifiedSchema,
  });
}

export async function resendAttendeeEmail(
  input: ResendAttendeeEmailInput,
): Promise<void> {
  await apiRequest(`${endpoints.attendee}/email-verification/resend`, {
    body: input,
    method: 'POST',
    responseSchema: attendeeEmailResendAcceptedSchema,
  });
}

export async function requestAdminActivation(
  input: RequestAdminActivationInput,
): Promise<void> {
  await apiRequest(`${endpoints.admin}/register`, {
    body: input,
    method: 'POST',
    responseSchema: adminActivationRequestedSchema,
  });
}

export async function activateAdmin(input: ActivateAdminInput): Promise<void> {
  await apiRequest(`${endpoints.admin}/activate`, {
    body: input,
    method: 'POST',
    responseSchema: adminActivatedSchema,
  });
}
