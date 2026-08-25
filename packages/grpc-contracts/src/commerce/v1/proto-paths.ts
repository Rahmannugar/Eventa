import { resolve } from 'node:path';

export function getCommerceProtoPaths(): string[] {
  return [
    resolve(__dirname, '../../../proto/eventa/commerce/v1/commerce_service.proto'),
  ];
}

export function getCommerceProtoIncludeDirs(): string[] {
  return [resolve(__dirname, '../../../proto')];
}
