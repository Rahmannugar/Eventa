import { HttpStatus, type ValidationError } from '@nestjs/common';

import { ApiHttpException } from './api-http.exception';
import type { ApiValidationError } from './api-error.types';

const CONSTRAINT_CODES: Readonly<Record<string, string>> = {
  isEmail: 'INVALID_FORMAT',
  isString: 'INVALID_TYPE',
  matches: 'INVALID_FORMAT',
  maxLength: 'TOO_LONG',
  minLength: 'TOO_SHORT',
  whitelistValidation: 'UNKNOWN_FIELD',
};

function flattenValidationErrors(
  validationErrors: ValidationError[],
  parent = '',
): ApiValidationError[] {
  return validationErrors.flatMap((validationError) => {
    const field =
      parent === ''
        ? validationError.property
        : `${parent}.${validationError.property}`;
    const ownErrors = Object.entries(validationError.constraints ?? {}).map(
      ([constraint, message]) => ({
        code: CONSTRAINT_CODES[constraint] ?? 'INVALID_VALUE',
        field,
        message,
      }),
    );

    return [
      ...ownErrors,
      ...flattenValidationErrors(validationError.children ?? [], field),
    ];
  });
}

export function createValidationException(
  validationErrors: ValidationError[],
): ApiHttpException {
  return new ApiHttpException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    'Check the highlighted fields and try again.',
    { errors: flattenValidationErrors(validationErrors) },
  );
}
