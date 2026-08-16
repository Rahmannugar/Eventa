import { z } from 'zod';

import { runtimeConfig } from '../../config/runtime-config';
import { ApiError } from './api-error';

const fieldErrorSchema = z.object({
  code: z.string(),
  field: z.string(),
  message: z.string(),
});

const apiErrorSchema = z.object({
  code: z.string(),
  errors: z.array(fieldErrorSchema).optional(),
  message: z.string(),
  statusCode: z.number().int(),
});

interface ApiRequestOptions<T> {
  body?: unknown;
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT';
  responseSchema: z.ZodType<T>;
  signal?: AbortSignal;
}

function readPositiveInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions<T>,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  let body: string | undefined;

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(new URL(path, runtimeConfig.apiBaseUrl), {
    ...(body === undefined ? {} : { body }),
    credentials: 'include',
    headers,
    method: options.method ?? 'GET',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(await readJson(response));

    if (parsedError.success) {
      throw new ApiError({
        code: parsedError.data.code,
        fieldErrors: parsedError.data.errors,
        message: parsedError.data.message,
        requestId: response.headers.get('x-request-id') ?? undefined,
        retryAfterSeconds: readPositiveInteger(
          response.headers.get('retry-after'),
        ),
        statusCode: parsedError.data.statusCode,
      });
    }

    throw new ApiError({
      code: 'UNEXPECTED_RESPONSE',
      message: 'Eventa returned an unexpected response.',
      requestId: response.headers.get('x-request-id') ?? undefined,
      statusCode: response.status,
    });
  }

  const parsedResponse = options.responseSchema.safeParse(
    await readJson(response),
  );

  if (!parsedResponse.success) {
    throw new ApiError({
      code: 'INVALID_API_RESPONSE',
      message: 'Eventa returned an invalid response.',
      requestId: response.headers.get('x-request-id') ?? undefined,
      statusCode: 502,
    });
  }

  return parsedResponse.data;
}

export async function apiCommand(
  path: string,
  options: Omit<ApiRequestOptions<undefined>, 'responseSchema'> = {},
): Promise<void> {
  const headers = new Headers({ Accept: 'application/json' });
  let body: string | undefined;

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(new URL(path, runtimeConfig.apiBaseUrl), {
    ...(body === undefined ? {} : { body }),
    credentials: 'include',
    headers,
    method: options.method ?? 'POST',
  });

  if (response.ok) return;

  const parsedError = apiErrorSchema.safeParse(await readJson(response));

  if (parsedError.success) {
    throw new ApiError({
      code: parsedError.data.code,
      fieldErrors: parsedError.data.errors,
      message: parsedError.data.message,
      requestId: response.headers.get('x-request-id') ?? undefined,
      retryAfterSeconds: readPositiveInteger(
        response.headers.get('retry-after'),
      ),
      statusCode: parsedError.data.statusCode,
    });
  }

  throw new ApiError({
    code: 'UNEXPECTED_RESPONSE',
    message: 'Eventa returned an unexpected response.',
    requestId: response.headers.get('x-request-id') ?? undefined,
    statusCode: response.status,
  });
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json') !== true) return undefined;

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
