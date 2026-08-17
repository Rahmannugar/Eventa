import {
  EventNotFoundError,
  EventTicketCurrencyConflictError,
  EventTicketCurrencyNotFoundError,
  EventTicketTypeInvalidError,
  EventTicketTypeLimitReachedError,
  EventTicketTypeMutationNotAllowedError,
  EventTicketTypeNameConflictError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  CreateEventTicketTypeCommand,
  DefineEventTicketCurrencyCommand,
  EventTicketTypeManagement,
  EventTicketTypeRepository,
  EventTicketTypeRecord,
  EventTicketTypesRecord,
} from '../types/event.types';

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EventTicketTypeService implements EventTicketTypeManagement {
  constructor(private readonly ticketTypes: EventTicketTypeRepository) {}

  async defineCurrency(input: DefineEventTicketCurrencyCommand) {
    const currency = input.currency.trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      throw new EventTicketTypeInvalidError();
    }

    const result = await this.ticketTypes.defineCurrency({
      ...input,
      currency,
    });
    if (result.outcome === 'not_found') throw new EventNotFoundError();
    if (result.outcome === 'not_draft') {
      throw new EventTicketTypeMutationNotAllowedError();
    }
    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }
    if (result.outcome === 'currency_conflict') {
      throw new EventTicketCurrencyConflictError();
    }
    return {
      eventVersion: result.eventVersion,
      ticketCurrency: result.ticketCurrency,
    };
  }

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
    const salesStartAt = new Date(input.salesStartAt);
    const salesEndAt = new Date(input.salesEndAt);

    if (
      name === '' ||
      name.length > 80 ||
      (description !== null && description.length > 500) ||
      !UUID_PATTERN.test(input.ticketCurrencyId) ||
      !Number.isInteger(input.priceMinor) ||
      input.priceMinor < 0 ||
      input.priceMinor > 2_147_483_647 ||
      !Number.isInteger(input.capacity) ||
      input.capacity < 1 ||
      input.capacity > 1_000_000 ||
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
      ticketCurrencyId: input.ticketCurrencyId,
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
    if (result.outcome === 'currency_not_found') {
      throw new EventTicketCurrencyNotFoundError();
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
