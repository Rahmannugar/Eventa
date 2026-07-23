import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { status, type Metadata } from '@grpc/grpc-js';

import { recordRequestMetrics } from '../metrics/request-metrics';

function readGrpcStatusCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }

  const errorRecord = error as Record<string, unknown>;
  const directCode = errorRecord.code;

  if (typeof directCode === 'number' || typeof directCode === 'string') {
    return String(directCode);
  }

  const getError = errorRecord.getError;

  if (typeof getError !== 'function') {
    return 'unknown';
  }

  const readRpcError = getError as (this: object) => unknown;
  const rpcError = readRpcError.call(error);

  if (typeof rpcError !== 'object' || rpcError === null) {
    return 'unknown';
  }

  const nestedCode = (rpcError as Record<string, unknown>).code;
  return typeof nestedCode === 'number' || typeof nestedCode === 'string'
    ? String(nestedCode)
    : 'unknown';
}

const CLIENT_ERROR_STATUS_CODES = new Set([
  String(status.CANCELLED),
  String(status.INVALID_ARGUMENT),
  String(status.NOT_FOUND),
  String(status.ALREADY_EXISTS),
  String(status.PERMISSION_DENIED),
  String(status.FAILED_PRECONDITION),
  String(status.ABORTED),
  String(status.OUT_OF_RANGE),
  String(status.UNAUTHENTICATED),
]);

export function classifyGrpcRequestOutcome(
  error: unknown,
): 'client_error' | 'server_error' {
  return CLIENT_ERROR_STATUS_CODES.has(readGrpcStatusCode(error))
    ? 'client_error'
    : 'server_error';
}

@Injectable()
export class RpcRequestTelemetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RpcRequestTelemetryInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();
    const operation = `${context.getClass().name}.${context.getHandler().name}`;
    const metadata = context.getArgByIndex<Metadata | undefined>(1);
    const requestIdValue = metadata?.get('x-request-id')[0];
    const requestId =
      typeof requestIdValue === 'string' ? requestIdValue : undefined;

    return next.handle().pipe(
      tap(() => this.complete(startedAt, operation, 'success', '0', requestId)),
      catchError((error: unknown) => {
        const statusCode = readGrpcStatusCode(error);
        this.complete(
          startedAt,
          operation,
          classifyGrpcRequestOutcome(error),
          statusCode,
          requestId,
        );
        return throwError(() => error);
      }),
    );
  }

  private complete(
    startedAt: bigint,
    operation: string,
    outcome: 'client_error' | 'server_error' | 'success',
    statusCode: string,
    requestId: string | undefined,
  ): void {
    const durationMilliseconds =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    recordRequestMetrics(durationMilliseconds, {
      operation,
      outcome,
      statusCode,
      transport: 'grpc',
    });
    this.logger.log({
      duration_ms: Number(durationMilliseconds.toFixed(3)),
      event: 'grpc_request_completed',
      operation,
      outcome,
      status_code: statusCode,
      ...(requestId === undefined ? {} : { request_id: requestId }),
    });
  }
}
