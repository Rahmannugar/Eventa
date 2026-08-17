import {
  EventNotFoundError,
  EventTicketTypeCurrencyConflictError,
  EventTicketTypeInvalidError,
  EventTicketTypeLimitReachedError,
  EventTicketTypeMutationNotAllowedError,
  EventTicketTypeNameConflictError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  CreateEventTicketTypeCommand,
  EventTicketTypeManagement,
  EventTicketTypeRepository,
  EventTicketTypeRecord,
  EventTicketTypesRecord,
} from '../types/event.types';

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

export class EventTicketTypeService implements EventTicketTypeManagement {
  constructor(private readonly ticketTypes: EventTicketTypeRepository) {}

  async create(input: CreateEventTicketTypeCommand): Promise<{
    eventVersion: number;
    ticketType: EventTicketTypeRecord;
  }> {
    const name = input.name.trim().replace(/\s+/g, ' ');
    const normalizedDescription = input.description?.trim();
    const description =
      normalizedDescription === undefined || normalizedDescription === ''
        ? null
        : normalizedDescription;
    const currency = input.currency.trim().toUpperCase();
    const salesStartAt = new Date(input.salesStartAt);
    const salesEndAt = new Date(input.salesEndAt);

    if (
      name === '' ||
      name.length > 80 ||
      (description !== null && description.length > 500) ||
      !SUPPORTED_CURRENCIES.has(currency) ||
      !Number.isInteger(input.priceMinor) ||
      input.priceMinor < 0 ||
      input.priceMinor > 2_147_483_647 ||
      !Number.isInteger(input.allocation) ||
      input.allocation < 1 ||
      input.allocation > 1_000_000 ||
      Number.isNaN(salesStartAt.getTime()) ||
      Number.isNaN(salesEndAt.getTime()) ||
      salesEndAt <= salesStartAt
    ) {
      throw new EventTicketTypeInvalidError();
    }

    const result = await this.ticketTypes.create({
      ...input,
      name,
      description,
      currency,
      salesStartAt,
      salesEndAt,
    });

    if (result.outcome === 'not_found') throw new EventNotFoundError();
    if (result.outcome === 'not_draft') {
      throw new EventTicketTypeMutationNotAllowedError();
    }
    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }
    if (result.outcome === 'currency_conflict') {
      throw new EventTicketTypeCurrencyConflictError();
    }
    if (result.outcome === 'name_conflict') {
      throw new EventTicketTypeNameConflictError();
    }
    if (result.outcome === 'limit_reached') {
      throw new EventTicketTypeLimitReachedError();
    }
    if (result.outcome === 'invalid_window') {
      throw new EventTicketTypeInvalidError();
    }

    return {
      eventVersion: result.eventVersion,
      ticketType: result.ticketType,
    };
  }

  async list(eventId: string): Promise<EventTicketTypesRecord> {
    const result = await this.ticketTypes.list(eventId);
    if (result === undefined) throw new EventNotFoundError();
    return result;
  }
}
