export interface FieldError {
  code: string;
  field: string;
  message: string;
}

interface ApiErrorOptions {
  code: string;
  fieldErrors?: FieldError[] | undefined;
  message: string;
  requestId?: string | undefined;
  retryAfterSeconds?: number | undefined;
  statusCode: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly fieldErrors: FieldError[];
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly statusCode: number;

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.fieldErrors = options.fieldErrors ?? [];
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.statusCode = options.statusCode;
  }
}

export function isSessionInvalid(error: unknown): error is ApiError {
  return error instanceof ApiError && error.statusCode === 401;
}

export function userFacingApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Eventa could not complete that request. Try again.';
  }

  if (error.statusCode === 429) {
    return error.retryAfterSeconds === undefined
      ? 'Too many attempts. Wait a moment and try again.'
      : `Too many attempts. Try again in ${String(error.retryAfterSeconds)} seconds.`;
  }

  if (error.statusCode >= 500) {
    return 'Eventa is temporarily unavailable. Try again.';
  }

  return error.message;
}
