import { trace } from '@opentelemetry/api';
import type { LoggerService } from '@nestjs/common';

type LogLevel = 'debug' | 'error' | 'info' | 'verbose' | 'warn';

interface LogRecord extends Record<string, unknown> {
  context?: string;
  level: LogLevel;
  message?: unknown;
  service: string;
  stack?: string;
  timestamp: string;
  trace_id?: string;
}

function isLogFields(message: unknown): message is Record<string, unknown> {
  return (
    typeof message === 'object' && message !== null && !Array.isArray(message)
  );
}

function readContext(optionalParams: unknown[]): string | undefined {
  const lastParameter = optionalParams.at(-1);

  return typeof lastParameter === 'string' ? lastParameter : undefined;
}

export class EventaLogger implements LoggerService {
  constructor(private readonly serviceName: string) {}

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const stack = optionalParams.find(
      (parameter): parameter is string =>
        typeof parameter === 'string' && parameter.includes('\n'),
    );

    this.write('error', message, optionalParams, stack);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  private write(
    level: LogLevel,
    message: unknown,
    optionalParams: unknown[],
    stack?: string,
  ): void {
    const spanContext = trace.getActiveSpan()?.spanContext();
    const record: LogRecord = {
      ...(isLogFields(message) ? message : { message }),
      level,
      service: this.serviceName,
      timestamp: new Date().toISOString(),
    };
    const context = readContext(optionalParams);

    if (context !== undefined) {
      record.context = context;
    }

    if (spanContext !== undefined) {
      record.trace_id = spanContext.traceId;
    }

    if (stack !== undefined) {
      record.stack = stack;
    }

    const destination = level === 'error' ? process.stderr : process.stdout;
    destination.write(`${JSON.stringify(record)}\n`);
  }
}
