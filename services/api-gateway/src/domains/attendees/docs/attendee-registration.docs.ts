import { applyDecorators } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../../docs/dto/api-error-response.dto';
import { RegisteredAttendeeDto } from '../dto/registered-attendee.dto';

interface ResponseHeader {
  description: string;
  schema: { example: string; type: 'string' };
}

type ResponseHeaders = Record<string, ResponseHeader>;

const rateLimitHeaders: ResponseHeaders = {
  RateLimit: {
    description:
      'Current quota state for every applicable registration policy.',
    schema: {
      example:
        '"ip-burst";r=4;t=12, "ip-hour";r=29;t=3600, "email-hour";r=4;t=3600',
      type: 'string',
    },
  },
  'RateLimit-Policy': {
    description: 'Registration rate-limit policies applied to the request.',
    schema: {
      example:
        '"ip-burst";q=5;w=60, "ip-hour";q=30;w=3600, "email-hour";q=5;w=3600',
      type: 'string',
    },
  },
};

const requestIdResponseHeader: ResponseHeader = {
  description: 'Identifier for correlating this request across Eventa.',
  schema: { example: '2e9436a4-0441-48ef-a5e8-3d830b843d40', type: 'string' },
};

const responseHeaders: ResponseHeaders = {
  ...rateLimitHeaders,
  'x-request-id': requestIdResponseHeader,
};

function errorResponse(
  status: number,
  description: string,
  examples: Record<string, { summary: string; value: object }>,
  headers: ResponseHeaders = responseHeaders,
): MethodDecorator {
  return ApiResponse({
    status,
    description,
    headers,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
        examples,
      },
    },
  });
}

export function ApiRegisterAttendee(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiHeader({
      description:
        'Optional client request identifier. Eventa preserves valid values.',
      name: 'x-request-id',
      required: false,
    }),
    ApiOperation({
      summary: 'Register an attendee account',
      description:
        'Creates an unverified attendee account after applying the registration security policy.',
    }),
    ApiCreatedResponse({
      description: 'The attendee account was created.',
      headers: responseHeaders,
      type: RegisteredAttendeeDto,
    }),
    errorResponse(400, 'The request body is not valid JSON.', {
      malformedJson: {
        summary: 'Malformed JSON',
        value: {
          code: 'INVALID_REQUEST',
          message: 'The request could not be parsed.',
          statusCode: 400,
        },
      },
    }),
    errorResponse(409, 'The email or username is unavailable.', {
      emailAlreadyRegistered: {
        summary: 'Email already registered',
        value: {
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An attendee account already uses this email address.',
          statusCode: 409,
        },
      },
      usernameUnavailable: {
        summary: 'Username unavailable',
        value: {
          code: 'USERNAME_UNAVAILABLE',
          message: 'Choose a different username.',
          statusCode: 409,
        },
      },
    }),
    errorResponse(422, 'One or more registration fields are invalid.', {
      passwordTooShort: {
        summary: 'Password is too short',
        value: {
          code: 'VALIDATION_FAILED',
          errors: [
            {
              code: 'TOO_SHORT',
              field: 'password',
              message: 'Password must be at least 12 characters.',
            },
          ],
          message: 'Check the highlighted fields and try again.',
          statusCode: 422,
        },
      },
    }),
    errorResponse(
      429,
      'Too many registration attempts were made.',
      {
        rateLimited: {
          summary: 'Registration temporarily rate limited',
          value: {
            code: 'REGISTRATION_RATE_LIMITED',
            message: 'Wait before trying to register again.',
            statusCode: 429,
          },
        },
      },
      {
        ...responseHeaders,
        'Retry-After': {
          description: 'Seconds before the request should be retried.',
          schema: { example: '12', type: 'string' },
        },
      },
    ),
    errorResponse(503, 'Registration is temporarily unavailable.', {
      unavailable: {
        summary: 'Registration dependency unavailable',
        value: {
          code: 'REGISTRATION_UNAVAILABLE',
          message: 'Registration is temporarily unavailable. Try again later.',
          statusCode: 503,
        },
      },
    }),
  );
}
