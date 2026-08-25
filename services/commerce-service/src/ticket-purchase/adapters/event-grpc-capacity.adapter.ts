import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  EventCapacityReservationStatus,
  type EventServiceClient,
} from '@eventa/grpc-contracts';
import { Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { EVENT_GRPC_CLIENT } from '../ticket-purchase.constants';
import type { EventCapacityPort, EventCapacityQuote } from '../types/event-capacity.port';

@Injectable()
export class EventGrpcCapacityAdapter
  implements EventCapacityPort, OnModuleInit
{
  private client!: EventServiceClient;

  constructor(
    @Inject(EVENT_GRPC_CLIENT)
    private readonly grpcClient: ClientGrpc,
    private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<EventServiceClient>('EventService');
  }

  async reserve(input: {
    reservationId: string;
    eventId: string;
    ticketTypeId: string;
    attendeeId: string;
    quantity: number;
    requestId: string;
  }): Promise<EventCapacityQuote> {
    const metadata = new Metadata();
    metadata.set('x-request-id', input.requestId);
    const reserve = this.client.reserveEventCapacity.bind(
      this.client,
    ) as unknown as (
      request: Parameters<EventServiceClient['reserveEventCapacity']>[0],
      metadata: Metadata,
      options: { deadline: Date },
    ) => ReturnType<EventServiceClient['reserveEventCapacity']>;
    const response = await firstValueFrom(
      reserve({
        attendeeId: input.attendeeId,
        eventId: input.eventId,
        quantity: input.quantity,
        reservationId: input.reservationId,
        ticketTypeId: input.ticketTypeId,
      }, metadata, {
        deadline: new Date(Date.now() + this.deadlineMs),
      }),
    );
    const reservation = response.reservation;
    if (
      response === undefined ||
      reservation === undefined ||
      reservation.reservationId !== input.reservationId ||
      reservation.eventId !== input.eventId ||
      reservation.ticketTypeId !== input.ticketTypeId ||
      reservation.attendeeId !== input.attendeeId ||
      reservation.quantity !== input.quantity ||
      reservation.status !==
        EventCapacityReservationStatus.EVENT_CAPACITY_RESERVATION_STATUS_ACTIVE ||
      !/^[A-Z]{3}$/.test(reservation.currency) ||
      !Number.isSafeInteger(reservation.unitPriceMinor) ||
      reservation.unitPriceMinor < 0 ||
      reservation.ticketName.trim() === ''
    ) {
      throw new Error('EVENT_CAPACITY_RESERVATION_INVALID_RESPONSE');
    }
    const expiresAt = new Date(reservation.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error('EVENT_CAPACITY_RESERVATION_INVALID_EXPIRY');
    }
    return {
      attendeeId: input.attendeeId,
      currency: reservation.currency,
      eventId: input.eventId,
      expiresAt,
      quantity: input.quantity,
      reservationId: input.reservationId,
      ticketName: reservation.ticketName,
      ticketTypeId: input.ticketTypeId,
      unitPriceMinor: reservation.unitPriceMinor,
    };
  }
}
