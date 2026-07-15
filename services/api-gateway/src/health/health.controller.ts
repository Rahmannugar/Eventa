import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get('live')
  @ApiOperation({ summary: 'Check whether the Gateway process is alive' })
  @ApiOkResponse({ type: HealthResponseDto })
  liveness(): HealthResponseDto {
    return {
      service: 'api-gateway',
      status: 'ok',
    };
  }
}
