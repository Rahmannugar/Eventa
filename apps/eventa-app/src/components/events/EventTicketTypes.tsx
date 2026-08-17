import { CalendarBlankIcon, PlusIcon, TicketIcon } from '@phosphor-icons/react';
import { ByteDateTimePicker } from 'byte-datepicker';
import {
  useState,
  type Dispatch,
  type FormEvent,
  type FormEventHandler,
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
  EventTicketCurrency,
  EventTicketType,
} from '../../lib/events/event.types';
import { localDateTimeToIso } from '../../lib/events/event.validation';
import {
  useCreateEventTicketType,
  useDefineEventTicketCurrency,
  useEventTicketTypes,
} from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

const currencies = Intl.supportedValuesOf('currency');

interface TicketTypeFormState {
  capacity: string;
  description: string;
  name: string;
  price: string;
  salesEndAt: string;
  salesStartAt: string;
}

const emptyTicketTypeForm: TicketTypeFormState = {
  capacity: '',
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
  const catalogue = useEventTicketTypes(event.eventId);
  const createTicketType = useCreateEventTicketType();
  const defineCurrency = useDefineEventTicketCurrency();
  const [definingCurrency, setDefiningCurrency] = useState(false);
  const [currency, setCurrency] = useState('');
  const [addingToCurrencyId, setAddingToCurrencyId] = useState<string>();
  const [form, setForm] = useState<TicketTypeFormState>(emptyTicketTypeForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const ticketCurrencies = catalogue.data?.ticketCurrencies ?? [];
  const canChange = event.status === 'draft';
  const canAddTicketType =
    canChange && (catalogue.data?.ticketTypes.length ?? 0) < 20;
  const sessionError =
    catalogue.error ?? createTicketType.error ?? defineCurrency.error;

  if (sessionError !== null && isSessionInvalid(sessionError)) {
    return (
      <Navigate
        replace
        to="/admin/login"
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  async function submitCurrency(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    if (currency === '') {
      setErrors({ currency: 'Choose a currency.' });
      return;
    }
    setErrors({});
    onOperationChange(true);
    try {
      await defineCurrency.mutateAsync({
        eventId: event.eventId,
        input: { currency, expectedVersion: event.version },
      });
      setCurrency('');
      setDefiningCurrency(false);
    } finally {
      onOperationChange(false);
    }
  }

  async function submitTicketType(
    submission: FormEvent<HTMLFormElement>,
    ticketCurrency: EventTicketCurrency,
  ) {
    submission.preventDefault();
    const validation = validate(
      form,
      ticketCurrency.currency,
      event.timeZone,
      event.startsAt,
    );
    if (validation.errors !== undefined) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    onOperationChange(true);
    try {
      await createTicketType.mutateAsync({
        eventId: event.eventId,
        input: {
          capacity: validation.capacity,
          ...(form.description.trim() === ''
            ? {}
            : { description: form.description.trim() }),
          expectedVersion: event.version,
          name: form.name.trim().replace(/\s+/g, ' '),
          priceMinor: validation.priceMinor,
          salesEndAt: validation.salesEndAt,
          salesStartAt: validation.salesStartAt,
          ticketCurrencyId: ticketCurrency.ticketCurrencyId,
        },
      });
      setForm(emptyTicketTypeForm);
      setAddingToCurrencyId(undefined);
    } finally {
      onOperationChange(false);
    }
  }

  function resetForms() {
    setAddingToCurrencyId(undefined);
    setDefiningCurrency(false);
    setCurrency('');
    setForm(emptyTicketTypeForm);
    setErrors({});
    createTicketType.reset();
    defineCurrency.reset();
  }

  const availableCurrencies = currencies.filter(
    (code) => !ticketCurrencies.some((entry) => entry.currency === code),
  );

  return (
    <section className="event-details-section" aria-labelledby="tickets-title">
      <div className="event-details-section__heading ticket-types__heading">
        <div>
          <h2 id="tickets-title">Tickets</h2>
          {catalogue.data === undefined ? null : (
            <span>
              {formatCapacityTotal(catalogue.data.ticketTypes)} capacity
            </span>
          )}
        </div>
        {canChange && !definingCurrency && addingToCurrencyId === undefined ? (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || catalogue.isPending}
            onClick={() => setDefiningCurrency(true)}
          >
            <PlusIcon aria-hidden="true" />
            Define currency
          </Button>
        ) : null}
      </div>
      <div className="event-details-section__body ticket-types">
        {catalogue.isPending ? (
          <p role="status">Loading tickets…</p>
        ) : catalogue.error !== null && catalogue.data === undefined ? (
          <div className="form-alert form-alert--error" role="alert">
            <span>Tickets could not be loaded.</span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void catalogue.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : ticketCurrencies.length === 0 && !definingCurrency ? (
          <div className="ticket-types__empty">
            <TicketIcon aria-hidden="true" />
            <p>No ticket currencies defined.</p>
            {canChange ? (
              <Button
                type="button"
                disabled={disabled}
                onClick={() => setDefiningCurrency(true)}
              >
                Define currency
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="ticket-currencies">
            {ticketCurrencies.map((ticketCurrency) => {
              const ticketTypes =
                catalogue.data?.ticketTypes.filter(
                  (ticketType) =>
                    ticketType.ticketCurrencyId ===
                    ticketCurrency.ticketCurrencyId,
                ) ?? [];
              return (
                <section
                  className="ticket-currency"
                  key={ticketCurrency.ticketCurrencyId}
                  aria-labelledby={`ticket-currency-${ticketCurrency.ticketCurrencyId}`}
                >
                  <div className="ticket-currency__heading">
                    <div>
                      <h3
                        id={`ticket-currency-${ticketCurrency.ticketCurrencyId}`}
                      >
                        {ticketCurrency.currency}
                      </h3>
                      <span>
                        {ticketTypes.length}{' '}
                        {ticketTypes.length === 1
                          ? 'ticket type'
                          : 'ticket types'}
                      </span>
                    </div>
                    {canAddTicketType &&
                    addingToCurrencyId === undefined &&
                    !definingCurrency ? (
                      <Button
                        type="button"
                        variant="quiet"
                        disabled={disabled}
                        onClick={() => {
                          setForm(emptyTicketTypeForm);
                          setAddingToCurrencyId(
                            ticketCurrency.ticketCurrencyId,
                          );
                        }}
                      >
                        <PlusIcon aria-hidden="true" />
                        Add ticket type
                      </Button>
                    ) : null}
                  </div>
                  {ticketTypes.length === 0 ? (
                    <p className="ticket-currency__empty">
                      No ticket types added.
                    </p>
                  ) : (
                    <div className="ticket-types__list">
                      {ticketTypes.map((ticketType) => (
                        <TicketTypeCard
                          key={ticketType.ticketTypeId}
                          currency={ticketCurrency.currency}
                          ticketType={ticketType}
                          timeZone={event.timeZone}
                        />
                      ))}
                    </div>
                  )}
                  {addingToCurrencyId === ticketCurrency.ticketCurrencyId ? (
                    <TicketTypeForm
                      currency={ticketCurrency.currency}
                      disabled={disabled}
                      errors={errors}
                      form={form}
                      pending={createTicketType.isPending}
                      error={createTicketType.error}
                      onCancel={resetForms}
                      onChange={setForm}
                      onReload={reload}
                      onResetError={createTicketType.reset}
                      onSubmit={(submission) => {
                        void submitTicketType(submission, ticketCurrency);
                      }}
                    />
                  ) : null}
                </section>
              );
            })}
          </div>
        )}

        {definingCurrency ? (
          <form
            className="ticket-currency-form"
            onSubmit={(submission) => void submitCurrency(submission)}
            noValidate
          >
            <label className="field" htmlFor="ticket-currency">
              <span>Currency</span>
              <select
                id="ticket-currency"
                value={currency}
                aria-invalid={errors.currency === undefined ? undefined : true}
                onChange={(change) => setCurrency(change.target.value)}
              >
                <option value="">Choose currency</option>
                {availableCurrencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              {errors.currency === undefined ? null : (
                <span className="field__error">{errors.currency}</span>
              )}
            </label>
            {defineCurrency.error === null ? null : (
              <MutationError
                error={defineCurrency.error}
                reload={reload}
                reset={defineCurrency.reset}
              />
            )}
            <div className="ticket-type-form__actions">
              <Button
                type="button"
                variant="quiet"
                disabled={defineCurrency.isPending}
                onClick={resetForms}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                busy={defineCurrency.isPending}
                disabled={disabled}
              >
                Define currency
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function TicketTypeForm({
  currency,
  disabled,
  error,
  errors,
  form,
  onCancel,
  onChange,
  onReload,
  onResetError,
  onSubmit,
  pending,
}: {
  currency: string;
  disabled: boolean;
  error: unknown;
  errors: Record<string, string>;
  form: TicketTypeFormState;
  onCancel: () => void;
  onChange: Dispatch<SetStateAction<TicketTypeFormState>>;
  onReload: () => Promise<AdminEvent>;
  onResetError: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  pending: boolean;
}) {
  return (
    <form className="ticket-type-form" onSubmit={onSubmit} noValidate>
      <div className="ticket-type-form__grid">
        <TextField
          id="ticket-type-name"
          label="Ticket name"
          maxLength={80}
          value={form.name}
          error={errors.name}
          onChange={(change) =>
            onChange({ ...form, name: change.target.value })
          }
        />
        <TextField
          id="ticket-type-price"
          label={`Price (${currency})`}
          inputMode="decimal"
          placeholder="0.00"
          value={form.price}
          error={errors.price}
          onChange={(change) =>
            onChange({ ...form, price: change.target.value })
          }
        />
        <TextField
          id="ticket-type-capacity"
          label="Capacity"
          inputMode="numeric"
          value={form.capacity}
          error={errors.capacity}
          onChange={(change) =>
            onChange({ ...form, capacity: change.target.value })
          }
        />
        <DateTimeField
          id="ticket-sales-start"
          label="Sales start"
          value={form.salesStartAt}
          error={errors.salesStartAt}
          onChange={(salesStartAt) => onChange({ ...form, salesStartAt })}
        />
        <DateTimeField
          id="ticket-sales-end"
          label="Sales end"
          value={form.salesEndAt}
          error={errors.salesEndAt}
          onChange={(salesEndAt) => onChange({ ...form, salesEndAt })}
        />
      </div>
      <label className="field" htmlFor="ticket-type-description">
        <span>
          Description <small>Optional</small>
        </span>
        <textarea
          id="ticket-type-description"
          maxLength={500}
          rows={3}
          value={form.description}
          onChange={(change) =>
            onChange({ ...form, description: change.target.value })
          }
        />
      </label>
      {error === null ? null : (
        <MutationError error={error} reload={onReload} reset={onResetError} />
      )}
      <div className="ticket-type-form__actions">
        <Button
          type="button"
          variant="quiet"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" busy={pending} disabled={disabled}>
          Add ticket type
        </Button>
      </div>
    </form>
  );
}

function MutationError({
  error,
  reload,
  reset,
}: {
  error: unknown;
  reload: () => Promise<AdminEvent>;
  reset: () => void;
}) {
  return (
    <div className="form-alert form-alert--error" role="alert">
      <span>{ticketTypeError(error)}</span>
      {error instanceof ApiError && error.code === 'EVENT_VERSION_CONFLICT' ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void reload()
              .then(reset)
              .catch(() => undefined);
          }}
        >
          Load latest event
        </Button>
      ) : null}
    </div>
  );
}

function TicketTypeCard({
  currency,
  ticketType,
  timeZone,
}: {
  currency: string;
  ticketType: EventTicketType;
  timeZone?: string | undefined;
}) {
  return (
    <article className="ticket-type-card">
      <div>
        <h4>{ticketType.name}</h4>
        {ticketType.description === undefined ? null : (
          <p>{ticketType.description}</p>
        )}
      </div>
      <dl>
        <div>
          <dt>Price</dt>
          <dd>{formatPrice(ticketType.priceMinor, currency)}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{ticketType.capacity.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Sales</dt>
          <dd>
            {formatPeriod(
              ticketType.salesStartAt,
              ticketType.salesEndAt,
              timeZone,
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function DateTimeField({
  error,
  id,
  label,
  onChange,
  value,
}: {
  error?: string | undefined;
  id: string;
  label: string;
  onChange: Dispatch<string>;
  value: string;
}) {
  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
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

function validate(
  form: TicketTypeFormState,
  currency: string,
  timeZone?: string,
  eventStartsAt?: string,
):
  | { errors: Record<string, string> }
  | {
      capacity: number;
      priceMinor: number;
      salesEndAt: string;
      salesStartAt: string;
      errors?: never;
    } {
  const errors: Record<string, string> = {};
  if (form.name.trim() === '') errors.name = 'Enter a ticket name.';
  const capacity = Number(form.capacity);
  if (!/^\d+$/.test(form.capacity) || capacity < 1 || capacity > 1_000_000)
    errors.capacity = 'Enter between 1 and 1,000,000 tickets.';
  const priceMinor = parsePrice(form.price, currency);
  if (priceMinor === undefined) errors.price = 'Enter a valid price.';
  if (form.salesStartAt === '')
    errors.salesStartAt = 'Choose when sales start.';
  if (form.salesEndAt === '') errors.salesEndAt = 'Choose when sales end.';
  if (timeZone === undefined)
    errors.salesStartAt = 'Set the event time zone first.';
  if (
    Object.keys(errors).length > 0 ||
    timeZone === undefined ||
    priceMinor === undefined
  )
    return { errors };
  try {
    const salesStartAt = localDateTimeToIso(form.salesStartAt, timeZone);
    const salesEndAt = localDateTimeToIso(form.salesEndAt, timeZone);
    if (salesEndAt <= salesStartAt)
      return { errors: { salesEndAt: 'Sales must end after they start.' } };
    if (eventStartsAt !== undefined && salesEndAt > eventStartsAt)
      return { errors: { salesEndAt: 'Sales must end by the event start.' } };
    return { capacity, priceMinor, salesEndAt, salesStartAt };
  } catch {
    return { errors: { salesStartAt: 'Choose valid dates and times.' } };
  }
}

function parsePrice(value: string, currency: string): number | undefined {
  const digits = currencyDigits(currency);
  const match = new RegExp(
    digits === 0 ? '^(\\d+)$' : `^(\\d+)(?:\\.(\\d{1,${String(digits)}}))?$`,
  ).exec(value.trim());
  if (match === null) return undefined;
  const minor = Number(`${match[1]}${(match[2] ?? '').padEnd(digits, '0')}`);
  return Number.isSafeInteger(minor) && minor <= 2_147_483_647
    ? minor
    : undefined;
}

function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    value / 10 ** currencyDigits(currency),
  );
}

function formatPeriod(start: string, end: string, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function formatCapacityTotal(ticketTypes: EventTicketType[]): string {
  return ticketTypes
    .reduce((total, ticketType) => total + ticketType.capacity, 0)
    .toLocaleString();
}

function formatLocalDateTime(date: Date | null): string {
  if (date === null) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ticketTypeError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'EVENT_VERSION_CONFLICT')
    return 'The event changed. Reload this page before changing tickets.';
  return userFacingApiError(error);
}
