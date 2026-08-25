import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequestId } from '../../../http/request-id.decorator';
import { AttendeeAuthenticationGuard } from '../../attendees/guards/attendee-authentication.guard';
import { AttendeeClientOriginGuard } from '../../attendees/guards/attendee-client-origin.guard';
import type { AttendeeAuthenticatedRequest } from '../../attendees/types/authenticated-attendee.types';
import {
  CheckoutOrderDto,
  CheckoutOrderPathDto,
  StartCheckoutDto,
} from '../dto/commerce-order.dto';
import { CommerceOrderRateLimitGuard } from '../rate-limit/commerce-order-rate-limit';
import { CommerceOrderService } from '../services/commerce-order.service';

@ApiTags('Checkout')
@ApiCookieAuth('attendeeSession')
@Controller('checkout')
export class CommerceOrderController {
  constructor(private readonly orders: CommerceOrderService) {}
  @Post()
  @UseGuards(
    AttendeeClientOriginGuard,
    CommerceOrderRateLimitGuard,
    AttendeeAuthenticationGuard,
  )
  @ApiOkResponse({ type: CheckoutOrderDto })
  start(
    @Body() body: StartCheckoutDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<CheckoutOrderDto> {
    return this.orders.start(
      body,
      request.attendeeSession.attendeeId,
      requestId,
    );
  }
  @Get(':orderId')
  @UseGuards(CommerceOrderRateLimitGuard, AttendeeAuthenticationGuard)
  @ApiOkResponse({ type: CheckoutOrderDto })
  get(
    @Param() path: CheckoutOrderPathDto,
    @Req() request: AttendeeAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<CheckoutOrderDto> {
    return this.orders.get(
      path.orderId,
      request.attendeeSession.attendeeId,
      requestId,
    );
  }
}
