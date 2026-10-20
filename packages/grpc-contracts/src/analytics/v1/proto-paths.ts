import { resolve } from 'node:path';

export function getAnalyticsProtoPaths(): string[] {
  return [
    resolve(
      __dirname,
      '../../../proto/eventa/analytics/v1/analytics_service.proto',
    ),
  ];
}

export function getAnalyticsProtoIncludeDirs(): string[] {
  return [resolve(__dirname, '../../../proto')];
}
