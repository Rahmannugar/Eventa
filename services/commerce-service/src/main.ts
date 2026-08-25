import 'reflect-metadata';

import {
  EVENTA_COMMERCE_V1_PACKAGE_NAME,
  getCommerceProtoIncludeDirs,
  getCommerceProtoPaths,
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

async function bootstrap(): Promise<void> {
  const config = readRuntimeConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config));
  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: () =>
        new RpcException({
          code: status.INVALID_ARGUMENT,
          message: 'INVALID_COMMERCE_REQUEST',
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
        package: EVENTA_COMMERCE_V1_PACKAGE_NAME,
        protoPath: getCommerceProtoPaths(),
        loader: {
          arrays: true,
          includeDirs: getCommerceProtoIncludeDirs(),
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
