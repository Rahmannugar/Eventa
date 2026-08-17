import { CalendarBlankIcon, PlusIcon, TicketIcon } from '@phosphor-icons/react';
import { ByteDateTimePicker } from 'byte-datepicker';
import {
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import {
  ApiError,
  isSessionInvalid,
  userFacingApiError,
} from '../../lib/api/api-error';
import type {
  AdminEvent,
  EventTicketType,
} from '../../lib/events/event.types';
import {
  localDateTimeToIso,
} from '../../lib/events/event.validation';
import {
  useCreateEventTicketType,
  useEventTicketTypes,
} from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

const currencies = Intl.supportedValuesOf('currency');

interface TicketTypeFormState {
  allocation: string;
  currency: string;
  description: string;
  name: string;
  price: string;
  salesEndAt: string;
  salesStartAt: string;
}

const emptyForm: TicketTypeFormState = {
  allocation: '',
  currency: '',
  description: '',
  name: '',
  price: '',
  salesEndAt: '',
  salesStartAt: '',
};

export function EventTicketTypes({
  disabled,
  event,
  onOperationChange,
  reload,
}: {
  disabled: boolean;
  event: AdminEvent;
  onOperationChange: Dispatch<SetStateAction<boolean>>;
  reload: () => Promise<AdminEvent>;
}) {
  const location = useLocation();
  const ticketTypes = useEventTicketTypes(event.eventId);
  const create = useCreateEventTicketType();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<TicketTypeFormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const configuredCurrency = ticketTypes.data?.currency;
  const effectiveCurrency = configuredCurrency ?? form.currency;
  const canAdd = event.status === 'draft' && (ticketTypes.data?.ticketTypes.length ?? 0) < 20;
  const sessionError = ticketTypes.error ?? create.error;

  if (sessionError !== null && isSessionInvalid(sessionError)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  async function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    const validation = validate(form, event.timeZone, event.startsAt);
    if (validation.errors !== undefined) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    onOperationChange(true);
    try {
      await create.mutateAsync({
        eventId: event.eventId,
        input: {
          allocation: validation.allocation,
          currency: configuredCurrency ?? form.currency,
          ...(form.description.trim() === ''
            ? {}
            : { description: form.description.trim() }),
          expectedVersion: event.version,
          name: form.name.trim().replace(/\s+/g, ' '),
          priceMinor: validation.priceMinor,
          salesEndAt: validation.salesEndAt,
          salesStartAt: validation.salesStartAt,
        },
      });
      setForm({ ...emptyForm, currency: configuredCurrency ?? form.currency });
      setAdding(false);
    } finally {
      onOperationChange(false);
    }
  }

  return (
    <section className="event-details-section" aria-labelledby="tickets-title">
      <div className="event-details-section__heading ticket-types__heading">
        <div>
          <h2 id="tickets-title">Tickets</h2>
          {ticketTypes.data === undefined ? null : (
            <span>
              {formatAllocationTotal(ticketTypes.data.ticketTypes)} allocated
            </span>
          )}
        </div>
        {canAdd && !adding ? (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || ticketTypes.isPending}
            onClick={() => {
              setForm({
                ...emptyForm,
                currency: configuredCurrency ?? '',
              });
              setAdding(true);
            }}
          >
            <PlusIcon aria-hidden="true" />
            Add ticket type
          </Button>
        ) : null}
      </div>
      <div className="event-details-section__body ticket-types">
        {ticketTypes.isPending ? (
          <p role="status">Loading tickets…</p>
        ) : ticketTypes.error !== null && ticketTypes.data === undefined ? (
          <div className="form-alert form-alert--error" role="alert">
            <span>Tickets could not be loaded.</span>
            <Button type="button" variant="secondary" onClick={() => void ticketTypes.refetch()}>
              Try again
            </Button>
          </div>
        ) : ticketTypes.data?.ticketTypes.length === 0 && !adding ? (
          <div className="ticket-types__empty">
            <TicketIcon aria-hidden="true" />
            <p>No ticket types added.</p>
            {canAdd ? (
              <Button
                type="button"
                disabled={disabled}
                onClick={() => setAdding(true)}
              >
                Add ticket type
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="ticket-types__list">
            {ticketTypes.data?.ticketTypes.map((ticketType) => (
              <TicketTypeCard
                key={ticketType.ticketTypeId}
                currency={ticketTypes.data.currency}
                ticketType={ticketType}
                timeZone={event.timeZone}
              />
            ))}
          </div>
        )}

        {adding ? (
          <form className="ticket-type-form" onSubmit={(submission) => void submit(submission)} noValidate>
            <div className="ticket-type-form__grid">
              <TextField
                id="ticket-type-name"
                label="Ticket name"
                maxLength={80}
                value={form.name}
                error={errors.name}
                onChange={(change) => setForm({ ...form, name: change.target.value })}
              />
              <label className="field" htmlFor="ticket-type-currency">
                <span>Currency</span>
                <select
                  id="ticket-type-currency"
                  disabled={configuredCurrency !== undefined}
                  value={effectiveCurrency}
                  aria-invalid={errors.currency === undefined ? undefined : true}
                  onChange={(change) => setForm({ ...form, currency: change.target.value })}
                >
                  <option value="">Choose currency</option>
                  {currencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
                {errors.currency === undefined ? null : <span className="field__error">{errors.currency}</span>}
              </label>
              <TextField
                id="ticket-type-price"
                label="Price"
                inputMode="decimal"
                placeholder="0.00"
                value={form.price}
                error={errors.price}
                onChange={(change) => setForm({ ...form, price: change.target.value })}
              />
              <TextField
                id="ticket-type-allocation"
                label="Number of tickets"
                inputMode="numeric"
                value={form.allocation}
                error={errors.allocation}
                onChange={(change) => setForm({ ...form, allocation: change.target.value })}
              />
              <DateTimeField
                id="ticket-sales-start"
                label="Sales start"
                value={form.salesStartAt}
                error={errors.salesStartAt}
                onChange={(salesStartAt) => setForm({ ...form, salesStartAt })}
              />
              <DateTimeField
                id="ticket-sales-end"
                label="Sales end"
                value={form.salesEndAt}
                error={errors.salesEndAt}
                onChange={(salesEndAt) => setForm({ ...form, salesEndAt })}
              />
            </div>
            <label className="field" htmlFor="ticket-type-description">
              <span>Description <small>Optional</small></span>
              <textarea
                id="ticket-type-description"
                maxLength={500}
                rows={3}
                value={form.description}
                onChange={(change) => setForm({ ...form, description: change.target.value })}
              />
            </label>
            {create.error === null ? null : (
              <div className="form-alert form-alert--error" role="alert">
                <span>{ticketTypeError(create.error)}</span>
                {create.error instanceof ApiError &&
                create.error.code === 'EVENT_VERSION_CONFLICT' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void reload()
                        .then(() => create.reset())
                        .catch(() => undefined);
                    }}
                  >
                    Load latest event
                  </Button>
                ) : null}
              </div>
            )}
            <div className="ticket-type-form__actions">
              <Button
                type="button"
                variant="quiet"
                disabled={create.isPending}
                onClick={() => {
                  setAdding(false);
                  setErrors({});
                  create.reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" busy={create.isPending} disabled={disabled}>
                Add ticket type
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function TicketTypeCard({ currency, ticketType, timeZone }: {
  currency?: string | undefined;
  ticketType: EventTicketType;
  timeZone?: string | undefined;
}) {
  return (
    <article className="ticket-type-card">
      <div>
        <h3>{ticketType.name}</h3>
        {ticketType.description === undefined ? null : <p>{ticketType.description}</p>}
      </div>
      <dl>
        <div><dt>Price</dt><dd>{currency === undefined ? 'Unavailable' : formatPrice(ticketType.priceMinor, currency)}</dd></div>
        <div><dt>Allocation</dt><dd>{ticketType.allocation.toLocaleString()}</dd></div>
        <div><dt>Sales</dt><dd>{formatPeriod(ticketType.salesStartAt, ticketType.salesEndAt, timeZone)}</dd></div>
      </dl>
    </article>
  );
}

function DateTimeField({ error, id, label, onChange, value }: {
  error?: string | undefined;
  id: string;
  label: string;
  onChange: Dispatch<string>;
  value: string;
}) {
  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>{label}</label>
      <ByteDateTimePicker
        className="event-date-time-picker"
        dateFormatString="dd mmm yyyy"
        error={error !== undefined}
        hideInput
        hourFormat={12}
        minuteStep={1}
        value={value === '' ? null : value}
        onChange={(date) => onChange(formatLocalDateTime(date))}
      >
        {({ formattedValue, isOpen, open }) => (
          <button
            id={id}
            type="button"
            className="date-picker__trigger"
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            aria-invalid={error === undefined ? undefined : true}
            aria-labelledby={`${id}-label`}
            onClick={open}
          >
            <CalendarBlankIcon aria-hidden="true" />
            <span>{formattedValue || 'Choose date and time'}</span>
          </button>
        )}
      </ByteDateTimePicker>
      {error === undefined ? null : <p className="field__error">{error}</p>}
    </div>
  );
}

function validate(form: TicketTypeFormState, timeZone?: string, eventStartsAt?: string):
  | { errors: Record<string, string> }
  | { allocation: number; priceMinor: number; salesEndAt: string; salesStartAt: string; errors?: never } {
  const errors: Record<string, string> = {};
  if (form.name.trim() === '') errors.name = 'Enter a ticket name.';
  if (form.currency === '') errors.currency = 'Choose a currency.';
  const allocation = Number(form.allocation);
  if (!/^\d+$/.test(form.allocation) || allocation < 1 || allocation > 1_000_000) {
    errors.allocation = 'Enter between 1 and 1,000,000 tickets.';
  }
  const priceMinor = parsePrice(form.price, form.currency);
  if (priceMinor === undefined) errors.price = 'Enter a valid price.';
  if (form.salesStartAt === '') errors.salesStartAt = 'Choose when sales start.';
  if (form.salesEndAt === '') errors.salesEndAt = 'Choose when sales end.';
  if (timeZone === undefined) errors.salesStartAt = 'Set the event time zone first.';
  if (Object.keys(errors).length > 0 || timeZone === undefined || priceMinor === undefined) return { errors };
  try {
    const salesStartAt = localDateTimeToIso(form.salesStartAt, timeZone);
    const salesEndAt = localDateTimeToIso(form.salesEndAt, timeZone);
    if (salesEndAt <= salesStartAt) {
      return { errors: { salesEndAt: 'Sales must end after they start.' } };
    }
    if (eventStartsAt !== undefined && salesEndAt > eventStartsAt) {
      return { errors: { salesEndAt: 'Sales must end by the event start.' } };
    }
    return { allocation, priceMinor, salesEndAt, salesStartAt };
  } catch {
    return { errors: { salesStartAt: 'Choose valid dates and times.' } };
  }
}

function parsePrice(value: string, currency: string): number | undefined {
  if (currency === '') return undefined;
  const digits = currencyDigits(currency);
  const match = new RegExp(
    digits === 0
      ? '^(\\d+)$'
      : `^(\\d+)(?:\\.(\\d{1,${String(digits)}}))?$`,
  ).exec(value.trim());
  if (match === null) return undefined;
  const minor = Number(`${match[1]}${(match[2] ?? '').padEnd(digits, '0')}`);
  return Number.isSafeInteger(minor) && minor <= 2_147_483_647 ? minor : undefined;
}

function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value / 10 ** currencyDigits(currency));
}

function formatPeriod(start: string, end: string, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium', timeStyle: 'short', ...(timeZone === undefined ? {} : { timeZone }),
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function formatAllocationTotal(ticketTypes: EventTicketType[]): string {
  return ticketTypes.reduce((total, ticketType) => total + ticketType.allocation, 0).toLocaleString();
}

function formatLocalDateTime(date: Date | null): string {
  if (date === null) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ticketTypeError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'EVENT_VERSION_CONFLICT') {
    return 'The event changed. Reload this page before adding the ticket type.';
  }
  return userFacingApiError(error);
}
