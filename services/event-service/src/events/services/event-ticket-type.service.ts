import {
  EventNotFoundError,
  EventTicketCurrencyConflictError,
  EventTicketCurrencyNotFoundError,
  EventTicketTypeCapacityBelowCommittedError,
  EventTicketTypeCapacityBelowWaitlistDemandError,
  EventTicketTypeCommercialTermsLockedError,
  EventTicketTypeInvalidError,
  EventTicketTypeLimitReachedError,
  EventTicketTypeMutationNotAllowedError,
  EventTicketTypeNameConflictError,
  EventTicketTypeNotFoundError,
  EventTicketTypeRetirementNotAllowedError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  CreateEventTicketTypeCommand,
  DefineEventTicketCurrencyCommand,
  EventTicketTypeManagement,
  EventTicketTypeRepository,
  EventTicketTypeRecord,
  EventTicketTypesRecord,
  RetireEventTicketTypeCommand,
  UpdateEventTicketTypeCommand,
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
    const values = this.normalizeTicketType(input);
    if (!UUID_PATTERN.test(input.ticketCurrencyId)) {
      throw new EventTicketTypeInvalidError();
    }

    const result = await this.ticketTypes.create({
      ...input,
      name: values.name,
      description: values.description,
      ticketCurrencyId: input.ticketCurrencyId,
      salesStartAt: values.salesStartAt,
      salesEndAt: values.salesEndAt,
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

  async update(input: UpdateEventTicketTypeCommand): Promise<{
    eventVersion: number;
    ticketType: EventTicketTypeRecord;
  }> {
    if (!UUID_PATTERN.test(input.ticketTypeId)) {
      throw new EventTicketTypeInvalidError();
    }
    const values = this.normalizeTicketType(input);
    const result = await this.ticketTypes.update({
      ...input,
      ...values,
    });
    if (result.outcome === 'not_found') {
      throw new EventTicketTypeNotFoundError();
    }
    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }
    if (result.outcome === 'name_conflict') {
      throw new EventTicketTypeNameConflictError();
    }
    if (result.outcome === 'invalid_window') {
      throw new EventTicketTypeInvalidError();
    }
    if (result.outcome === 'capacity_below_committed') {
      throw new EventTicketTypeCapacityBelowCommittedError();
    }
    if (result.outcome === 'capacity_below_waitlist_demand') {
      throw new EventTicketTypeCapacityBelowWaitlistDemandError();
    }
    if (result.outcome === 'commercial_terms_locked') {
      throw new EventTicketTypeCommercialTermsLockedError();
    }
    return {
      eventVersion: result.eventVersion,
      ticketType: result.ticketType,
    };
  }

  async retire(input: RetireEventTicketTypeCommand) {
    if (!UUID_PATTERN.test(input.ticketTypeId)) {
      throw new EventTicketTypeInvalidError();
    }
    const result = await this.ticketTypes.retire(input);
    if (result.outcome === 'not_found') {
      throw new EventTicketTypeNotFoundError();
    }
    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }
    if (result.outcome === 'committed_inventory') {
      throw new EventTicketTypeRetirementNotAllowedError(
        'EVENT_TICKET_TYPE_HAS_COMMITTED_INVENTORY',
      );
    }
    if (result.outcome === 'last_published_type') {
      throw new EventTicketTypeRetirementNotAllowedError(
        'EVENT_TICKET_TYPE_LAST_PUBLISHED_TYPE',
      );
    }
    return result.eventVersion;
  }

  async list(eventId: string): Promise<EventTicketTypesRecord> {
    const result = await this.ticketTypes.list(eventId);
    if (result === undefined) throw new EventNotFoundError();
    return result;
  }

  private normalizeTicketType(input: {
    name: string;
    description?: string;
    priceMinor: number;
    capacity: number;
    salesStartAt: string;
    salesEndAt: string;
  }) {
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
    return { description, name, salesEndAt, salesStartAt };
  }
}
