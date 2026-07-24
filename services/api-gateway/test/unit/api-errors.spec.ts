import type { ValidationError } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { createValidationException } from '../../src/http/errors/validation-errors';

describe('API validation errors', () => {
  it('returns field-safe 422 details instead of a generic 400 response', () => {
    const validationErrors: ValidationError[] = [
      {
        children: [],
        constraints: {
          minLength: 'Password must be at least 8 characters.',
        },
        property: 'password',
      },
    ];

    const exception = createValidationException(validationErrors);

    expect(exception.getStatus()).toBe(422);
    expect(exception.getResponse()).toEqual({
      code: 'VALIDATION_FAILED',
      errors: [
        {
          code: 'TOO_SHORT',
          field: 'password',
          message: 'Password must be at least 8 characters.',
        },
      ],
      message: 'Check the highlighted fields and try again.',
      statusCode: 422,
    });
    expect(exception.validationErrors).toEqual(['password.TOO_SHORT']);
  });
});
