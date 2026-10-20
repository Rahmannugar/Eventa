import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import { AdminAuthenticationGuard } from '../../admins/guards/admin-authentication.guard';
import { AdminClientOriginGuard } from '../../admins/guards/admin-client-origin.guard';
import {
  AnalyticsEventDto,
  AnalyticsEventListDto,
  AnalyticsEventPathDto,
  AnalyticsListQueryDto,
  PortfolioSummaryDto,
} from '../dto/analytics.dto';
import { AdminAnalyticsReadRateLimitGuard } from '../rate-limit/admin-analytics-rate-limit';
import { AdminAnalyticsService } from '../services/admin-analytics.service';

@ApiTags('Admin analytics')
@ApiCookieAuth('adminSession')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('events')
  @UseGuards(
    AdminClientOriginGuard,
    AdminAnalyticsReadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'List per-event performance' })
  @ApiResponse({ status: HttpStatus.OK, type: AnalyticsEventListDto })
  list(
    @Query() query: AnalyticsListQueryDto,
    @RequestId() requestId: string,
  ): Promise<AnalyticsEventListDto> {
    return this.analytics.list(query, requestId);
  }

  @Get('events/:eventId')
  @UseGuards(
    AdminClientOriginGuard,
    AdminAnalyticsReadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Get one event performance record' })
  @ApiResponse({ status: HttpStatus.OK, type: AnalyticsEventDto })
  get(
    @Param() path: AnalyticsEventPathDto,
    @RequestId() requestId: string,
  ): Promise<AnalyticsEventDto> {
    return this.analytics.get(path.eventId, requestId);
  }

  @Get('summary')
  @UseGuards(
    AdminClientOriginGuard,
    AdminAnalyticsReadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Get the portfolio summary' })
  @ApiResponse({ status: HttpStatus.OK, type: PortfolioSummaryDto })
  summary(@RequestId() requestId: string): Promise<PortfolioSummaryDto> {
    return this.analytics.summary(requestId);
  }
}
