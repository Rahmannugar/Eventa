import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { readRuntimeConfig } from './config/runtime-config';
import { setupApiDocumentation } from './docs/open-api';
import { EventaLogger } from '@eventa/observability';
import { ApiErrorFilter } from './http/errors/api-error.filter';
import { createValidationException } from './http/errors/validation-errors';

async function bootstrap(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(config),
    { logger: new EventaLogger('eventa-api-gateway') },
  );

  app.set('trust proxy', config.trustProxyHops);
  app.useGlobalFilters(new ApiErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: createValidationException,
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  if (config.apiDocsEnabled) {
    setupApiDocumentation(app, config.publicApiUrl);
  }

  app.enableShutdownHooks();

  const server = app.getHttpServer();
  server.requestTimeout = config.httpRequestTimeoutMs;
  server.headersTimeout = config.httpHeadersTimeoutMs;
  server.keepAliveTimeout = config.httpKeepAliveTimeoutMs;

  await app.listen(config.port);
}

void bootstrap();
