import { trace, type Span } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => vi.restoreAllMocks());

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

  it('names the active HTTP span from the normalized route after routing', () => {
    const updateName = vi.fn();
    const setAttribute = vi.fn();
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      setAttribute,
      spanContext: () => ({
        spanId: '0123456789abcdef',
        traceFlags: 1,
        traceId: '0123456789abcdef0123456789abcdef',
      }),
      updateName,
    } as unknown as Span);
    const middleware = new HttpRequestTelemetryMiddleware();
    const request: {
      headers: Record<string, string>;
      method: string;
      path: string;
      route?: { path: string };
    } = {
      headers: {},
      method: 'POST',
      path: '/auth/attendees/email-verification/confirm',
    };
    const response = createMutableResponse();

    middleware.use(request, response, () => {
      request.route = {
        path: '/auth/attendees/email-verification/confirm',
      };
    });

    expect(updateName).toHaveBeenCalledWith(
      'POST /auth/attendees/email-verification/confirm',
    );
    expect(setAttribute).toHaveBeenCalledWith(
      'http.route',
      '/auth/attendees/email-verification/confirm',
    );
  });

  it('uses a bounded span name when no route matched', () => {
    const updateName = vi.fn();
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({
        spanId: '0123456789abcdef',
        traceFlags: 1,
        traceId: '0123456789abcdef0123456789abcdef',
      }),
      updateName,
    } as unknown as Span);
    const middleware = new HttpRequestTelemetryMiddleware();
    const request = {
      headers: {},
      method: 'GET',
      path: '/arbitrary/high-cardinality/value',
    };

    middleware.use(request, createMutableResponse(), () => undefined);

    expect(updateName).toHaveBeenCalledWith('GET unmatched');
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
