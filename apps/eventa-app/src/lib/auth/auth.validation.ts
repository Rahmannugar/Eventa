import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.').max(320, 'Email is too long.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must not exceed 128 characters.'),
});
