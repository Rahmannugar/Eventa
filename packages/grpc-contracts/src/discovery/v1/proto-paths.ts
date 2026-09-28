import { resolve } from 'node:path';

export function getDiscoveryProtoPaths(): string[] {
  return [
    resolve(
      __dirname,
      '../../../proto/eventa/discovery/v1/discovery_service.proto',
    ),
  ];
}

export function getDiscoveryProtoIncludeDirs(): string[] {
  return [resolve(__dirname, '../../../proto')];
}
