import { randomUUID } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';

import { recordRequestMetrics } from '../metrics/request-metrics';

interface HttpRequest {
  method: string;
  originalUrl?: string;
  path?: string;
  route?: { path?: string };
}

interface HttpResponse {
  getHeader(name: string): number | string | string[] | undefined;
  once(event: 'finish', listener: () => void): void;
  setHeader(name: string, value: string): void;
  statusCode: number;
}

function readOperation(request: HttpRequest): string {
  const route = request.route?.path;

  if (route !== undefined) {
    return `${request.method} ${route}`;
  }

  return `${request.method} ${request.path ?? 'unmatched'}`;
}

function readOutcome(
  statusCode: number,
): 'client_error' | 'server_error' | 'success' {
  if (statusCode >= 500) {
    return 'server_error';
  }

  if (statusCode >= 400) {
    return 'client_error';
  }

  return 'success';
}

@Injectable()
export class HttpRequestTelemetryMiddleware implements NestMiddleware {
  private readonly logger = new Logger(HttpRequestTelemetryMiddleware.name);

  use(request: HttpRequest, response: HttpResponse, next: () => void): void {
    const startedAt = process.hrtime.bigint();
    const requestIdHeader = response.getHeader('x-request-id');
    const requestId =
      typeof requestIdHeader === 'string' ? requestIdHeader : randomUUID();
    const traceId = trace.getActiveSpan()?.spanContext().traceId;

    response.setHeader('x-request-id', requestId);
    response.once('finish', () => {
      const durationMilliseconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const operation = readOperation(request);
      const outcome = readOutcome(response.statusCode);
      const isSuccessfulHealthProbe =
        outcome === 'success' &&
        (request.path === '/health/live' || request.path === '/health/ready');

      if (!isSuccessfulHealthProbe) {
        recordRequestMetrics(durationMilliseconds, {
          operation,
          outcome,
          statusCode: String(response.statusCode),
          transport: 'http',
        });
        this.logger.log({
          duration_ms: Number(durationMilliseconds.toFixed(3)),
          event: 'http_request_completed',
          method: request.method,
          operation,
          outcome,
          request_id: requestId,
          status_code: response.statusCode,
          ...(traceId === undefined ? {} : { trace_id: traceId }),
        });
      }
    });

    next();
  }
}
