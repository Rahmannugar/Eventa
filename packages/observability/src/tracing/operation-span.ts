import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api';

interface OperationSpanOptions {
  attributes?: Attributes;
  kind?: 'client' | 'internal';
}

const tracer = trace.getTracer('@eventa/observability');

export function runWithOperationSpan<T>(
  name: string,
  operation: () => Promise<T>,
  options: OperationSpanOptions = {},
): Promise<T> {
  const spanOptions: SpanOptions = {
    kind: options.kind === 'client' ? SpanKind.CLIENT : SpanKind.INTERNAL,
    ...(options.attributes === undefined
      ? {}
      : { attributes: options.attributes }),
  };
  const execute = async (span: Span): Promise<T> => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: unknown) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute(
        'error.type',
        error instanceof Error ? error.name : 'UnknownError',
      );
      throw error;
    } finally {
      span.end();
    }
  };

  return tracer.startActiveSpan(name, spanOptions, execute);
}
