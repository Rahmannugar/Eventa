import { Controller, Get, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import {
  PublishedEventDto,
  PublishedEventPathDto,
} from '../dto/published-event.dto';
import { PublishedEventReadRateLimitGuard } from '../rate-limit/published-event-rate-limit';
import { PublishedEventService } from '../services/published-event.service';

@ApiTags('Events')
@Controller('events')
export class PublishedEventController {
  constructor(private readonly events: PublishedEventService) {}

  @Get(':eventId')
  @UseGuards(PublishedEventReadRateLimitGuard)
  @ApiOperation({ summary: 'Get published event details' })
  @ApiResponse({ status: HttpStatus.OK, type: PublishedEventDto })
  get(
    @Param() path: PublishedEventPathDto,
    @RequestId() requestId: string,
  ): Promise<PublishedEventDto> {
    return this.events.getById(path.eventId, requestId);
  }
}
