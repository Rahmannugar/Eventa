import { apiReference } from '@scalar/nestjs-api-reference';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function setupApiDocumentation(app: NestExpressApplication): void {
  const documentConfig = new DocumentBuilder()
    .setTitle('Eventa API')
    .setDescription('Public HTTP contract exposed by the Eventa API Gateway.')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });

  SwaggerModule.setup('openapi', app, document, {
    jsonDocumentUrl: 'openapi.json',
    raw: ['json', 'yaml'],
    ui: false,
    yamlDocumentUrl: 'openapi.yaml',
  });
  app.use(
    '/docs',
    apiReference({
      pageTitle: 'Eventa API Reference',
      url: '/openapi.json',
    }),
  );
}
