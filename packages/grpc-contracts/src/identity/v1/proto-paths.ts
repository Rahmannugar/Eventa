import { resolve } from 'node:path';

export function getIdentityProtoPath(): string {
  return resolve(
    __dirname,
    '../../../proto/eventa/identity/v1/attendee_identity_service.proto',
  );
}

export function getIdentityProtoIncludeDirs(): string[] {
  return [resolve(__dirname, '../../../proto')];
}
