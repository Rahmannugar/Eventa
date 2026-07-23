import {
  EVENTA_IDENTITY_V1_PACKAGE_NAME,
  getIdentityProtoIncludeDirs,
  getIdentityProtoPath,
} from '@eventa/grpc-contracts';
import { status } from '@grpc/grpc-js';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  RpcException,
  Transport,
  type MicroserviceOptions,
} from '@nestjs/microservices';

import { AppModule } from './app.module';
import { readRuntimeConfig } from './config/runtime-config';
import { EventaLogger } from '@eventa/observability';

async function bootstrap(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config), {
    logger: new EventaLogger('eventa-identity-service'),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: () =>
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'INVALID_REGISTRATION_REQUEST',
        }),
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.GRPC,
      options: {
        package: EVENTA_IDENTITY_V1_PACKAGE_NAME,
        protoPath: getIdentityProtoPath(),
        loader: {
          includeDirs: getIdentityProtoIncludeDirs(),
        },
        url: `${config.grpcHost}:${config.grpcPort}`,
      },
    },
    { inheritAppConfig: true },
  );
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.listen(config.healthPort);
}

void bootstrap();
