import { resolve } from 'node:path';

export function getEventProtoPaths(): string[] {
  return [
    resolve(__dirname, '../../../proto/eventa/event/v1/event_service.proto'),
  ];
}

export function getEventProtoIncludeDirs(): string[] {
  return [resolve(__dirname, '../../../proto')];
}
