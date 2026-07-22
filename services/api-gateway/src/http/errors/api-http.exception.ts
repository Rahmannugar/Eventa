import { HttpException } from '@nestjs/common';

import type { ApiErrorResponse, ApiValidationError } from './api-error.types';

interface ApiHttpExceptionOptions {
  diagnosticCode?: string;
  errors?: ApiValidationError[];
}

export class ApiHttpException extends HttpException {
  readonly diagnosticCode: string;
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
    this.validationErrors = options.errors?.map(
      (error) => `${error.field}.${error.code}`,
    );
  }
}
