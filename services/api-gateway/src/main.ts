import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { readRuntimeConfig } from './config/runtime-config';
import { setupApiDocumentation } from './docs/open-api';
import { EventaLogger } from '@eventa/observability';

async function bootstrap(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(config),
    { logger: new EventaLogger('eventa-api-gateway') },
  );

  app.set('trust proxy', config.trustProxyHops);
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  if (config.apiDocsEnabled) {
    setupApiDocumentation(app);
  }

  app.enableShutdownHooks();

  await app.listen(config.port);
}

void bootstrap();
