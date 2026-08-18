import {
  EVENT_SERVICE_NAME,
  AttendeeTicketAvailabilityStatus,
  type AttendeeEventTicketType,
  type EventTicketCurrency,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import {
  EVENT_GRPC_CLIENT,
  EVENT_GRPC_DEADLINE_MS,
} from '../constants/event.constants';
import type {
  AttendeeTicketCatalogueDto,
  AttendeeTicketTypeDto,
} from '../dto/attendee-ticket-catalogue.dto';
import type { DeadlineAwareEventServiceClient } from '../types/event-grpc-client.types';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class AttendeeTicketCatalogueService implements OnModuleInit {
  private events?: DeadlineAwareEventServiceClient;

  constructor(
    @Inject(EVENT_GRPC_CLIENT) private readonly grpcClient: ClientGrpc,
    @Inject(EVENT_GRPC_DEADLINE_MS) private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.events =
      this.grpcClient.getService<DeadlineAwareEventServiceClient>(
        EVENT_SERVICE_NAME,
      );
  }

  async get(
    eventId: string,
    attendeeId: string,
    requestId: string,
  ): Promise<AttendeeTicketCatalogueDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().getAttendeeEventTicketCatalogue(
          { attendeeId, eventId },
          this.metadata(requestId),
          { deadline: new Date(Date.now() + this.deadlineMs) },
        ),
      );
      if (response.eventId !== eventId) {
        throw this.unavailable('ATTENDEE_TICKET_CATALOGUE_RESPONSE_INVALID');
      }
      const currencies = this.validateCurrencies(
        response.ticketCurrencies,
        eventId,
      );
      if (currencies.size === 0 || response.ticketTypes.length === 0) {
        throw this.unavailable('ATTENDEE_TICKET_CATALOGUE_RESPONSE_INVALID');
      }
      const typesByCurrency = new Map<string, AttendeeTicketTypeDto[]>();
      const ticketTypeIds = new Set<string>();
      for (const ticketType of response.ticketTypes) {
        if (
          ticketType.eventId !== eventId ||
          !currencies.has(ticketType.ticketCurrencyId) ||
          ticketTypeIds.has(ticketType.ticketTypeId)
        ) {
          throw this.unavailable('ATTENDEE_TICKET_CATALOGUE_RESPONSE_INVALID');
        }
        ticketTypeIds.add(ticketType.ticketTypeId);
        const mapped = this.toTicketType(ticketType);
        const group = typesByCurrency.get(ticketType.ticketCurrencyId) ?? [];
        group.push(mapped);
        typesByCurrency.set(ticketType.ticketCurrencyId, group);
      }
      return {
        eventId,
        currencies: [...currencies.values()].map((currency) => ({
          currency: currency.currency,
          ticketTypes: typesByCurrency.get(currency.ticketCurrencyId) ?? [],
        })),
      };
    } catch (error: unknown) {
      if (errorCode(error) === status.NOT_FOUND) {
        throw new ApiHttpException(
          HttpStatus.NOT_FOUND,
          'EVENT_NOT_FOUND',
          'Event was not found.',
        );
      }
      if (errorCode(error) === status.DEADLINE_EXCEEDED) {
        throw this.unavailable('EVENT_TICKET_CATALOGUE_RPC_DEADLINE_EXCEEDED');
      }
      if (error instanceof ApiHttpException) throw error;
      throw this.unavailable('EVENT_TICKET_CATALOGUE_RPC_UNAVAILABLE');
    }
  }

  private validateCurrencies(
    currencies: EventTicketCurrency[],
    eventId: string,
  ): Map<string, EventTicketCurrency> {
    const byId = new Map<string, EventTicketCurrency>();
    const codes = new Set<string>();
    for (const currency of currencies) {
      if (
        currency.eventId !== eventId ||
        currency.ticketCurrencyId === '' ||
        !/^[A-Z]{3}$/.test(currency.currency) ||
        codes.has(currency.currency) ||
        byId.has(currency.ticketCurrencyId) ||
        !this.validTimestamp(currency.createdAt) ||
        !this.validTimestamp(currency.updatedAt) ||
        Date.parse(currency.updatedAt) < Date.parse(currency.createdAt)
      ) {
        throw this.unavailable('ATTENDEE_TICKET_CATALOGUE_RESPONSE_INVALID');
      }
      codes.add(currency.currency);
      byId.set(currency.ticketCurrencyId, currency);
    }
    return byId;
  }

  private toTicketType(
    ticketType: AttendeeEventTicketType,
  ): AttendeeTicketTypeDto {
    const salesStartAt = Date.parse(ticketType.salesStartAt);
    const salesEndAt = Date.parse(ticketType.salesEndAt);
    const opportunityExpiresAt = Date.parse(
      ticketType.opportunityExpiresAt ?? '',
    );
    const reservationExpiresAt = Date.parse(
      ticketType.reservationExpiresAt ?? '',
    );
    const statusValue = ticketType.availabilityStatus;
    const statusName = this.availabilityStatus(statusValue);
    if (
      ticketType.ticketTypeId === '' ||
      ticketType.name === '' ||
      !Number.isInteger(ticketType.priceMinor) ||
      ticketType.priceMinor < 0 ||
      !Number.isFinite(salesStartAt) ||
      !Number.isFinite(salesEndAt) ||
      salesEndAt <= salesStartAt ||
      statusName === undefined ||
      !Number.isInteger(ticketType.availableQuantity) ||
      ticketType.availableQuantity < 0 ||
      !this.validAvailabilityShape(
        ticketType,
        statusName,
        opportunityExpiresAt,
        reservationExpiresAt,
      )
    ) {
      throw this.unavailable('ATTENDEE_TICKET_CATALOGUE_RESPONSE_INVALID');
    }
    return {
      availability: {
        status: statusName,
        quantity: ticketType.availableQuantity,
        salesOpen: ticketType.salesOpen,
        canJoinWaitlist: ticketType.canJoinWaitlist,
        ...(ticketType.waitlistPosition === undefined
          ? {}
          : { waitlistPosition: ticketType.waitlistPosition }),
        ...(ticketType.opportunityExpiresAt === undefined
          ? {}
          : { opportunityExpiresAt: ticketType.opportunityExpiresAt }),
        ...(ticketType.reservationExpiresAt === undefined
          ? {}
          : { reservationExpiresAt: ticketType.reservationExpiresAt }),
      },
      ...(ticketType.description === undefined
        ? {}
        : { description: ticketType.description }),
      name: ticketType.name,
      priceMinor: ticketType.priceMinor,
      salesEndAt: ticketType.salesEndAt,
      salesStartAt: ticketType.salesStartAt,
      ticketTypeId: ticketType.ticketTypeId,
    };
  }

  private validAvailabilityShape(
    ticketType: AttendeeEventTicketType,
    statusName: AttendeeTicketTypeDto['availability']['status'],
    opportunityExpiresAt: number,
    reservationExpiresAt: number,
  ): boolean {
    const positiveQuantity = ticketType.availableQuantity > 0;
    if (statusName === 'available') {
      return (
        ticketType.salesOpen &&
        positiveQuantity &&
        ticketType.waitlistPosition === undefined &&
        ticketType.opportunityExpiresAt === undefined &&
        ticketType.reservationExpiresAt === undefined
      );
    }
    if (statusName === 'waiting') {
      return (
        ticketType.salesOpen &&
        ticketType.availableQuantity === 0 &&
        Number.isInteger(ticketType.waitlistPosition) &&
        (ticketType.waitlistPosition ?? 0) > 0 &&
        ticketType.opportunityExpiresAt === undefined &&
        ticketType.reservationExpiresAt === undefined
      );
    }
    if (statusName === 'eligible') {
      return (
        ticketType.salesOpen &&
        positiveQuantity &&
        ticketType.waitlistPosition === undefined &&
        Number.isFinite(opportunityExpiresAt) &&
        opportunityExpiresAt > Date.now() &&
        ticketType.reservationExpiresAt === undefined
      );
    }
    if (statusName === 'reserved') {
      return (
        ticketType.salesOpen &&
        positiveQuantity &&
        ticketType.waitlistPosition === undefined &&
        ticketType.opportunityExpiresAt === undefined &&
        Number.isFinite(reservationExpiresAt) &&
        reservationExpiresAt > Date.now()
      );
    }
    return (
      ticketType.availableQuantity === 0 &&
      ticketType.waitlistPosition === undefined &&
      ticketType.opportunityExpiresAt === undefined &&
      ticketType.reservationExpiresAt === undefined
    );
  }

  private availabilityStatus(
    statusValue: AttendeeTicketAvailabilityStatus,
  ): AttendeeTicketTypeDto['availability']['status'] | undefined {
    switch (statusValue) {
      case AttendeeTicketAvailabilityStatus.ATTENDEE_TICKET_AVAILABILITY_STATUS_AVAILABLE:
        return 'available';
      case AttendeeTicketAvailabilityStatus.ATTENDEE_TICKET_AVAILABILITY_STATUS_WAITING:
        return 'waiting';
      case AttendeeTicketAvailabilityStatus.ATTENDEE_TICKET_AVAILABILITY_STATUS_ELIGIBLE:
        return 'eligible';
      case AttendeeTicketAvailabilityStatus.ATTENDEE_TICKET_AVAILABILITY_STATUS_RESERVED:
        return 'reserved';
      case AttendeeTicketAvailabilityStatus.ATTENDEE_TICKET_AVAILABILITY_STATUS_UNAVAILABLE:
        return 'unavailable';
      default:
        return undefined;
    }
  }

  private validTimestamp(value: string): boolean {
    return value !== '' && Number.isFinite(Date.parse(value));
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private requireClient(): DeadlineAwareEventServiceClient {
    if (this.events === undefined) {
      throw this.unavailable('EVENT_CLIENT_UNAVAILABLE');
    }
    return this.events;
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'EVENT_SERVICE_UNAVAILABLE',
      'Ticket options are temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
