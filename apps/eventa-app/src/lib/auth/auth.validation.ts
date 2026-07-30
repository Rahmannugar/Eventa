import { z } from 'zod';

export const emailSchema = z
  .email('Enter a valid email address.')
  .max(320, 'Email is too long.');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must not exceed 128 characters.');

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const registerAttendeeSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters.')
    .max(30, 'Username must not exceed 30 characters.')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Username may contain only letters, numbers, and underscores.',
    ),
});

export const confirmAttendeeEmailSchema = z.object({
  email: emailSchema,
  otp: z
    .string()
    .regex(/^\d{6}$/, 'Verification code must contain exactly 6 digits.'),
});

export const requestAdminActivationSchema = z.object({
  email: emailSchema,
});

export const activateAdminSchema = z.object({
  email: emailSchema,
  otp: z
    .string()
    .regex(/^\d{6}$/, 'Activation code must contain exactly 6 digits.'),
  password: passwordSchema,
});
