import { applyDecorators } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../../docs/dto/api-error-response.dto';
import { CurrentAttendeeAccountDto } from '../dto/current-attendee-account.dto';

function errorResponse(
  status: number,
  code: string,
  message: string,
): MethodDecorator {
  return ApiResponse({
    status,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
        example: { code, message, statusCode: status },
      },
    },
  });
}

export function ApiGetCurrentAttendeeAccount(): MethodDecorator {
  return applyDecorators(
    ApiCookieAuth('attendeeSession'),
    ApiExtraModels(ApiErrorResponseDto),
    ApiOperation({ summary: 'Get the signed-in attendee' }),
    ApiOkResponse({ type: CurrentAttendeeAccountDto }),
    errorResponse(401, 'SESSION_INVALID', 'Sign in to continue.'),
    errorResponse(
      429,
      'ACCOUNT_RATE_LIMITED',
      'Wait before requesting your account again.',
    ),
    errorResponse(
      503,
      'AUTHENTICATION_UNAVAILABLE',
      'Authentication is temporarily unavailable. Try again later.',
    ),
  );
}

export function ApiLogoutAttendee(): MethodDecorator {
  return applyDecorators(
    ApiCookieAuth('attendeeSession'),
    ApiExtraModels(ApiErrorResponseDto),
    ApiHeader({
      description: 'Must exactly match the configured attendee client origin.',
      name: 'Origin',
      required: true,
    }),
    ApiOperation({ summary: 'Sign out the current attendee session' }),
    ApiNoContentResponse({
      description:
        'The presented session was revoked, or no usable session cookie was present.',
    }),
    errorResponse(403, 'UNTRUSTED_ORIGIN', 'Request origin is not allowed.'),
    errorResponse(
      429,
      'LOGOUT_RATE_LIMITED',
      'Wait before trying to sign out again.',
    ),
    errorResponse(
      503,
      'AUTHENTICATION_UNAVAILABLE',
      'Authentication is temporarily unavailable. Try again later.',
    ),
  );
}

export function ApiDeleteAttendeeAccount(): MethodDecorator {
  return applyDecorators(
    ApiCookieAuth('attendeeSession'),
    ApiExtraModels(ApiErrorResponseDto),
    ApiHeader({
      description: 'Must exactly match the configured attendee client origin.',
      name: 'Origin',
      required: true,
    }),
    ApiOperation({ summary: 'Delete the signed-in attendee account' }),
    ApiNoContentResponse({
      description: 'The attendee account was deleted and all sessions revoked.',
    }),
    errorResponse(401, 'SESSION_INVALID', 'Sign in to continue.'),
    errorResponse(
      403,
      'CURRENT_PASSWORD_INCORRECT',
      'The current password is incorrect.',
    ),
    errorResponse(
      429,
      'ACCOUNT_DELETION_RATE_LIMITED',
      'Wait before trying to delete your account again.',
    ),
    errorResponse(
      503,
      'ACCOUNT_DELETION_UNAVAILABLE',
      'Account deletion is temporarily unavailable. Try again later.',
    ),
  );
}
