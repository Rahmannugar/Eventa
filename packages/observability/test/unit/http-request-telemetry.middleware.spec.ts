import { describe, expect, it } from 'vitest';

import { HttpRequestTelemetryMiddleware } from '../../src/nest/http-request-telemetry.middleware';

interface TestResponse {
  headers: Map<string, string>;
  listener?: () => void;
  locals: object;
  once(event: 'finish', listener: () => void): void;
  setHeader(name: string, value: string): void;
  statusCode: number;
}

describe('HttpRequestTelemetryMiddleware', () => {
  it('preserves a valid incoming request ID for downstream calls and the response', () => {
    const middleware = new HttpRequestTelemetryMiddleware();
    const request = {
      headers: { 'x-request-id': 'client-request-42' },
      method: 'POST',
      path: '/auth/attendees/register',
    };
    const response = createMutableResponse();

    middleware.use(request, response, () => undefined);

    expect(request.headers['x-request-id']).toBe('client-request-42');
    expect(response.headers.get('x-request-id')).toBe('client-request-42');
  });

  it('replaces an invalid incoming request ID with a bounded generated value', () => {
    const middleware = new HttpRequestTelemetryMiddleware();
    const request = {
      headers: { 'x-request-id': 'invalid value with spaces' },
      method: 'GET',
      path: '/unknown',
    };
    const response = createMutableResponse();

    middleware.use(request, response, () => undefined);

    expect(request.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.headers.get('x-request-id')).toBe(
      request.headers['x-request-id'],
    );
  });
});

function createMutableResponse(): TestResponse {
  const response: TestResponse = {
    headers: new Map(),
    locals: {},
    once: (_event, listener) => {
      response.listener = listener;
    },
    setHeader: (name, value) => response.headers.set(name, value),
    statusCode: 200,
  };

  return response;
}
