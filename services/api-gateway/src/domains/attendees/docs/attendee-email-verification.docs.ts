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
  ConfirmAttendeeEmailVerificationResponseDto,
  ResendAttendeeEmailVerificationResponseDto,
} from '../dto/attendee-email-verification.dto';

const requestHeaders = {
  'x-request-id': {
    description: 'Identifier for correlating this request across Eventa.',
    schema: { example: '2e9436a4-0441-48ef-a5e8-3d830b843d40', type: 'string' },
  },
} as const;

function rateLimitHeaders(
  policyExample: string,
  stateExample: string,
): Record<
  string,
  { description: string; schema: { example: string; type: 'string' } }
> {
  return {
    ...requestHeaders,
    RateLimit: {
      description: 'Quota state for the applicable endpoint policies.',
      schema: { example: stateExample, type: 'string' },
    },
    'RateLimit-Policy': {
      description: 'Rate-limit policies applied to this endpoint.',
      schema: { example: policyExample, type: 'string' },
    },
  };
}

const confirmRateLimitHeaders = rateLimitHeaders(
  '"ip-burst";q=10;w=60, "ip-hour";q=120;w=3600, "email-hour";q=30;w=3600',
  '"ip-burst";r=9;t=6, "ip-hour";r=119;t=3600, "email-hour";r=29;t=3600',
);

const resendRateLimitHeaders = rateLimitHeaders(
  '"ip-burst";q=5;w=60, "ip-hour";q=30;w=3600, "email-hour";q=20;w=3600',
  '"ip-burst";r=4;t=12, "ip-hour";r=29;t=3600, "email-hour";r=19;t=3600',
);

function errorResponse(
  status: number,
  description: string,
  code: string,
  message: string,
  headers: ReturnType<typeof rateLimitHeaders>,
  retryAfter = false,
): MethodDecorator {
  return ApiResponse({
    status,
    description,
    headers: retryAfter
      ? {
          ...headers,
          'Retry-After': {
            description: 'Seconds before the request should be retried.',
            schema: { example: '60', type: 'string' },
          },
        }
      : headers,
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(ApiErrorResponseDto) },
        example: { code, message, statusCode: status },
      },
    },
  });
}

function commonDecorators(summary: string): MethodDecorator[] {
  return [ApiExtraModels(ApiErrorResponseDto), ApiOperation({ summary })];
}

export function ApiConfirmAttendeeEmailVerification(): MethodDecorator {
  return applyDecorators(
    ...commonDecorators('Confirm an attendee email address'),
    ApiOkResponse({
      description: 'The attendee email address is verified.',
      headers: confirmRateLimitHeaders,
      type: ConfirmAttendeeEmailVerificationResponseDto,
    }),
    errorResponse(
      400,
      'The verification code is invalid, expired, replaced, or exhausted.',
      'EMAIL_VERIFICATION_INVALID',
      'The verification code is invalid or has expired.',
      confirmRateLimitHeaders,
    ),
    errorResponse(
      422,
      'The email address or verification-code shape is invalid.',
      'VALIDATION_FAILED',
      'Check the highlighted fields and try again.',
      confirmRateLimitHeaders,
    ),
    errorResponse(
      429,
      'Too many confirmation attempts were made.',
      'EMAIL_VERIFICATION_CONFIRM_RATE_LIMITED',
      'Wait before trying another verification code.',
      confirmRateLimitHeaders,
      true,
    ),
    errorResponse(
      503,
      'Email verification is temporarily unavailable.',
      'EMAIL_VERIFICATION_UNAVAILABLE',
      'Email verification is temporarily unavailable. Try again later.',
      confirmRateLimitHeaders,
    ),
  );
}

export function ApiResendAttendeeEmailVerification(): MethodDecorator {
  return applyDecorators(
    ...commonDecorators('Resend an attendee verification email'),
    ApiAcceptedResponse({
      description:
        'The resend request is accepted without disclosing account state.',
      headers: resendRateLimitHeaders,
      type: ResendAttendeeEmailVerificationResponseDto,
    }),
    errorResponse(
      422,
      'The email address shape is invalid.',
      'VALIDATION_FAILED',
      'Check the highlighted fields and try again.',
      resendRateLimitHeaders,
    ),
    errorResponse(
      429,
      'The endpoint policy or resend cooldown denied the request.',
      'EMAIL_VERIFICATION_RESEND_RATE_LIMITED',
      'Wait before requesting another verification email.',
      resendRateLimitHeaders,
      true,
    ),
    errorResponse(
      503,
      'Email verification is temporarily unavailable.',
      'EMAIL_VERIFICATION_UNAVAILABLE',
      'Email verification is temporarily unavailable. Try again later.',
      resendRateLimitHeaders,
    ),
  );
}
