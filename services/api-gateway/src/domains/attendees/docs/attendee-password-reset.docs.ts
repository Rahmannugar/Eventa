import { applyDecorators } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from '../../../docs/dto/api-error-response.dto';
import {
  ForgotAttendeePasswordResponseDto,
  ResetAttendeePasswordResponseDto,
} from '../dto/attendee-password-reset.dto';

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

export function ApiForgotAttendeePassword(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiOperation({ summary: 'Request an attendee password reset email' }),
    ApiAcceptedResponse({ type: ForgotAttendeePasswordResponseDto }),
    errorResponse(
      429,
      'FORGOT_PASSWORD_RATE_LIMITED',
      'Wait before requesting another password reset email.',
    ),
    errorResponse(
      503,
      'PASSWORD_RESET_UNAVAILABLE',
      'Password reset is temporarily unavailable. Try again later.',
    ),
  );
}

export function ApiResetAttendeePassword(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiOperation({
      summary: 'Reset an attendee password with an emailed code',
    }),
    ApiOkResponse({ type: ResetAttendeePasswordResponseDto }),
    errorResponse(
      400,
      'PASSWORD_RESET_INVALID',
      'The password reset code is invalid or has expired.',
    ),
    errorResponse(
      429,
      'RESET_PASSWORD_RATE_LIMITED',
      'Wait before trying another password reset code.',
    ),
    errorResponse(
      503,
      'PASSWORD_RESET_UNAVAILABLE',
      'Password reset is temporarily unavailable. Try again later.',
    ),
  );
}
