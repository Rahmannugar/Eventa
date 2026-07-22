import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';

import { ApiHttpException } from './api-http.exception';
import type { ApiErrorResponse, ApiErrorTelemetry } from './api-error.types';

interface ErrorResponse {
  locals?: {
    eventaError?: ApiErrorTelemetry;
  };
  status(statusCode: number): ErrorResponse;
  json(body: ApiErrorResponse): void;
}

function defaultError(statusCode: number): ApiErrorResponse {
  if (statusCode === HttpStatus.BAD_REQUEST) {
    return {
      code: 'INVALID_REQUEST',
      message: 'The request could not be parsed.',
      statusCode,
    };
  }

  if (statusCode === HttpStatus.NOT_FOUND) {
    return {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      statusCode,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed.',
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ErrorResponse>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof ApiHttpException
        ? (exception.getResponse() as ApiErrorResponse)
        : defaultError(statusCode);
    const telemetry: ApiErrorTelemetry = {
      errorCode:
        exception instanceof ApiHttpException
          ? exception.diagnosticCode
          : body.code,
      ...(exception instanceof ApiHttpException &&
      exception.validationErrors !== undefined
        ? { validationErrors: exception.validationErrors }
        : {}),
    };

    response.locals ??= {};
    response.locals.eventaError = telemetry;

    if (!(exception instanceof HttpException)) {
      this.logger.error({
        error_type:
          exception instanceof Error ? exception.name : 'UnknownException',
        event: 'unhandled_http_exception',
      });
    }

    response.status(body.statusCode).json(body);
  }
}
