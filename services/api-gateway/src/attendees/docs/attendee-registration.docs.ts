import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';

import { RegisteredAttendeeDto } from '../dto/registered-attendee.dto';
import { ApiErrorResponseDto } from '../../docs/dto/api-error-response.dto';

const rateLimitHeaders = {
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

export function ApiRegisterAttendee(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Register an attendee account',
      description:
        'Creates an unverified attendee account and profile after applying the registration security policy.',
    }),
    ApiCreatedResponse({
      description: 'The attendee account and profile were created atomically.',
      headers: rateLimitHeaders,
      type: RegisteredAttendeeDto,
    }),
    ApiBadRequestResponse({
      description: 'The registration request failed boundary validation.',
      headers: rateLimitHeaders,
      type: ApiErrorResponseDto,
    }),
    ApiConflictResponse({
      description: 'The canonical email or username is already registered.',
      headers: rateLimitHeaders,
      type: ApiErrorResponseDto,
    }),
    ApiTooManyRequestsResponse({
      description: 'A registration rate-limit policy denied the request.',
      headers: {
        ...rateLimitHeaders,
        'Retry-After': {
          description: 'Seconds before the request should be retried.',
          schema: { example: '12', type: 'string' },
        },
      },
      type: ApiErrorResponseDto,
    }),
    ApiServiceUnavailableResponse({
      description:
        'Registration cannot safely continue because Redis or Identity is unavailable.',
      type: ApiErrorResponseDto,
    }),
  );
}
