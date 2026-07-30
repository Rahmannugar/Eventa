import { z } from 'zod';

const apiBaseUrlSchema = z
  .url('VITE_API_BASE_URL must be a valid HTTP or HTTPS URL.')
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  }, 'VITE_API_BASE_URL must be an HTTP or HTTPS origin.');

export function readApiBaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('VITE_API_BASE_URL is required.');
  }

  const result = apiBaseUrlSchema.safeParse(value.trim());

  if (!result.success) {
    throw new Error(
      result.error.issues[0]?.message ?? 'VITE_API_BASE_URL is invalid.',
    );
  }

  return new URL(result.data).origin;
}

const rawApiBaseUrl: unknown = import.meta.env.VITE_API_BASE_URL;

export const runtimeConfig = {
  apiBaseUrl: readApiBaseUrl(
    typeof rawApiBaseUrl === 'string' ? rawApiBaseUrl : undefined,
  ),
} as const;
