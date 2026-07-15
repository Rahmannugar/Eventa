import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { readRuntimeConfig } from './config/runtime-config';

async function bootstrap(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  await app.listen(config.port);
}

void bootstrap();
