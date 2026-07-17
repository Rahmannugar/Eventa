import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { stopTelemetry } from '../tracing/telemetry';

@Injectable()
export class TelemetryLifecycleService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await stopTelemetry();
  }
}
