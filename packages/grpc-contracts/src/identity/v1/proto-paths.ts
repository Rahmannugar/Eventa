import { resolve } from 'node:path';

export function getIdentityProtoPaths(): string[] {
  return [
    resolve(
      __dirname,
      '../../../proto/eventa/identity/v1/admin_identity_service.proto',
    ),
    resolve(
      __dirname,
      '../../../proto/eventa/identity/v1/attendee_identity_service.proto',
    ),
  ];
}

export function getIdentityProtoIncludeDirs(): string[] {
  return [resolve(__dirname, '../../../proto')];
}
