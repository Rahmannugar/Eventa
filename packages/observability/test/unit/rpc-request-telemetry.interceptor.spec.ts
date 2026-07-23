import { status } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';

import { classifyGrpcRequestOutcome } from '../../src/nest/rpc-request-telemetry.interceptor';

describe('classifyGrpcRequestOutcome', () => {
  it.each([
    status.CANCELLED,
    status.INVALID_ARGUMENT,
    status.NOT_FOUND,
    status.ALREADY_EXISTS,
    status.PERMISSION_DENIED,
    status.FAILED_PRECONDITION,
    status.ABORTED,
    status.OUT_OF_RANGE,
    status.UNAUTHENTICATED,
  ])('classifies caller-facing gRPC status %s as a client error', (code) => {
    expect(classifyGrpcRequestOutcome({ code })).toBe('client_error');
  });

  it.each([
    status.UNKNOWN,
    status.DEADLINE_EXCEEDED,
    status.RESOURCE_EXHAUSTED,
    status.UNIMPLEMENTED,
    status.INTERNAL,
    status.UNAVAILABLE,
    status.DATA_LOSS,
  ])('classifies operational gRPC status %s as a server error', (code) => {
    expect(classifyGrpcRequestOutcome({ code })).toBe('server_error');
  });

  it('classifies an unreadable error as a server error', () => {
    expect(classifyGrpcRequestOutcome(new Error('unexpected'))).toBe(
      'server_error',
    );
  });
});
