import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../../docs/dto/api-error-response.dto';
import { LoggedInAttendeeDto } from '../dto/login-attendee.dto';

function errorResponse(
  status: number,
  description: string,
  code: string,
  message: string,
): MethodDecorator {
  return ApiResponse({
    status,
    description,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
        example: { code, message, statusCode: status },
      },
    },
  });
}

function accountStateErrorResponse(): MethodDecorator {
  return ApiResponse({
    status: 403,
    description: 'The credentials are correct but the account cannot sign in.',
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
        examples: {
          unverified: {
            value: {
              code: 'EMAIL_VERIFICATION_REQUIRED',
              message: 'Verify your email before signing in.',
              statusCode: 403,
            },
          },
          suspended: {
            value: {
              code: 'ACCOUNT_SUSPENDED',
              message: 'This account has been suspended.',
              statusCode: 403,
            },
          },
          deleted: {
            value: {
              code: 'ACCOUNT_DELETED',
              message: 'This account has been deleted.',
              statusCode: 403,
            },
          },
        },
      },
    },
  });
}

export function ApiLoginAttendee(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiHeader({
      description:
        'Optional client request identifier. Eventa preserves valid values.',
      name: 'x-request-id',
      required: false,
    }),
    ApiOperation({ summary: 'Sign in an attendee' }),
    ApiOkResponse({
      description:
        'The attendee is signed in and the session is returned as an HttpOnly cookie.',
      type: LoggedInAttendeeDto,
    }),
    errorResponse(
      401,
      'The credentials are incorrect.',
      'INVALID_CREDENTIALS',
      'Email or password is incorrect.',
    ),
    accountStateErrorResponse(),
    errorResponse(
      422,
      'One or more login fields are invalid.',
      'VALIDATION_FAILED',
      'Check the highlighted fields and try again.',
    ),
    errorResponse(
      429,
      'Too many login attempts were made.',
      'LOGIN_RATE_LIMITED',
      'Wait before trying to sign in again.',
    ),
    errorResponse(
      503,
      'Authentication is temporarily unavailable.',
      'AUTHENTICATION_UNAVAILABLE',
      'Sign in is temporarily unavailable. Try again later.',
    ),
  );
}
