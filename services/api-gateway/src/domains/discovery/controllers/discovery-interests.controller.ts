import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import { AttendeeAuthenticationGuard } from '../../attendees/guards/attendee-authentication.guard';
import type { AttendeeAuthenticatedRequest } from '../../attendees/types/authenticated-attendee.types';
import {
  AttendeeInterestsDto,
  SetAttendeeInterestsDto,
} from '../dto/discovery-interests.dto';
import {
  InterestsReadRateLimitGuard,
  InterestsWriteRateLimitGuard,
} from '../rate-limit/discovery-interests-rate-limit';
import { DiscoveryInterestsService } from '../services/discovery-interests.service';

@ApiTags('Interests')
@ApiCookieAuth('attendeeSession')
@Controller('attendees/me/interests')
export class DiscoveryInterestsController {
  constructor(private readonly discovery: DiscoveryInterestsService) {}

  @Get()
  @UseGuards(InterestsReadRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiOperation({ summary: 'Read the signed-in attendee’s interests' })
  @ApiOkResponse({ type: AttendeeInterestsDto })
  get(
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<AttendeeInterestsDto> {
    return this.discovery.get(request.attendeeSession.attendeeId, requestId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @UseGuards(InterestsWriteRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiOperation({ summary: 'Replace the signed-in attendee’s interests' })
  @ApiOkResponse({ type: AttendeeInterestsDto })
  set(
    @Body() body: SetAttendeeInterestsDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<AttendeeInterestsDto> {
    return this.discovery.set(
      request.attendeeSession.attendeeId,
      body,
      requestId,
    );
  }
}
