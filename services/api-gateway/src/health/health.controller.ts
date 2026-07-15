import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  service: 'api-gateway';
  status: 'ok';
}

@Controller('health')
export class HealthController {
  @Get('live')
  liveness(): HealthResponse {
    return {
      service: 'api-gateway',
      status: 'ok',
    };
  }
}
