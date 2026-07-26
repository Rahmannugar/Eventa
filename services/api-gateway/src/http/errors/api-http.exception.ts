import { HttpException } from '@nestjs/common';

import type { ApiErrorResponse, ApiValidationError } from './api-error.types';

interface ApiHttpExceptionOptions {
  diagnosticCode?: string;
  errors?: ApiValidationError[];
  headers?: Readonly<Record<string, string>>;
}

export class ApiHttpException extends HttpException {
  readonly diagnosticCode: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly validationErrors: string[] | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: ApiHttpExceptionOptions = {},
  ) {
    const response: ApiErrorResponse = {
      code,
      message,
      statusCode,
      ...(options.errors === undefined ? {} : { errors: options.errors }),
    };

    super(response, statusCode);
    this.diagnosticCode = options.diagnosticCode ?? code;
    this.headers = options.headers ?? {};
    this.validationErrors = options.errors?.map(
      (error) => `${error.field}.${error.code}`,
    );
  }
}
