import {
  CalendarBlankIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { ByteDateTimePicker } from 'byte-datepicker';
import type { Dispatch, FormEventHandler, SetStateAction } from 'react';

import { ApiError, userFacingApiError } from '../../lib/api/api-error';
import {
  currencyDigits,
  type TicketTypeFormState,
} from '../../lib/events/event-ticket-type-form';
import type { AdminEvent, EventTicketType } from '../../lib/events/event.types';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

export function TicketTypeForm({
  commercialTermsLocked,
  currency,
  disabled,
  error,
  errors,
  form,
  idPrefix,
  onCancel,
  onChange,
  onReload,
  onResetError,
  onSubmit,
  pending,
  submitLabel,
}: {
  commercialTermsLocked: boolean;
  currency: string;
  disabled: boolean;
  error: unknown;
  errors: Record<string, string>;
  form: TicketTypeFormState;
  idPrefix: string;
  onCancel: () => void;
  onChange: Dispatch<SetStateAction<TicketTypeFormState>>;
  onReload: () => Promise<AdminEvent>;
  onResetError: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <form className="ticket-type-form" onSubmit={onSubmit} noValidate>
      <div className="ticket-type-form__grid">
        <TextField
          id={`${idPrefix}-name`}
          label="Ticket name"
          maxLength={80}
          value={form.name}
          error={errors.name}
          onChange={(change) =>
            onChange({ ...form, name: change.target.value })
          }
        />
        <TextField
          id={`${idPrefix}-price`}
          label={`Price (${currency})`}
          inputMode="decimal"
          placeholder="0.00"
          value={form.price}
          error={errors.price}
          disabled={commercialTermsLocked}
          onChange={(change) =>
            onChange({ ...form, price: change.target.value })
          }
        />
        <TextField
          id={`${idPrefix}-capacity`}
          label="Capacity"
          inputMode="numeric"
          value={form.capacity}
          error={errors.capacity}
          onChange={(change) =>
            onChange({ ...form, capacity: change.target.value })
          }
        />
        <DateTimeField
          disabled={commercialTermsLocked}
          id={`${idPrefix}-sales-start`}
          label="Sales start"
          value={form.salesStartAt}
          error={errors.salesStartAt}
          onChange={(salesStartAt) => onChange({ ...form, salesStartAt })}
        />
        <DateTimeField
          disabled={commercialTermsLocked}
          id={`${idPrefix}-sales-end`}
          label="Sales end"
          value={form.salesEndAt}
          error={errors.salesEndAt}
          onChange={(salesEndAt) => onChange({ ...form, salesEndAt })}
        />
      </div>
      {commercialTermsLocked ? (
        <p className="ticket-type-form__locked">
          Price and sales dates cannot change after tickets are reserved or
          sold.
        </p>
      ) : null}
      <label className="field" htmlFor={`${idPrefix}-description`}>
        <span>
          Description <small>Optional</small>
        </span>
        <textarea
          id={`${idPrefix}-description`}
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
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function MutationError({
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

export function TicketTypeCard({
  currency,
  disabled,
  onEdit,
  onRetire,
  ticketType,
  timeZone,
}: {
  currency: string;
  disabled: boolean;
  onEdit: () => void;
  onRetire: () => void;
  ticketType: EventTicketType;
  timeZone?: string | undefined;
}) {
  return (
    <article className="ticket-type-card">
      <div className="ticket-type-card__heading">
        <div>
          <h4>{ticketType.name}</h4>
          {ticketType.description === undefined ? null : (
            <p>{ticketType.description}</p>
          )}
        </div>
        <div className="ticket-type-card__actions">
          <Button
            type="button"
            variant="quiet"
            disabled={disabled}
            onClick={onEdit}
          >
            <PencilSimpleIcon aria-hidden="true" />
            Edit
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={disabled}
            onClick={onRetire}
          >
            <TrashIcon aria-hidden="true" />
            Remove
          </Button>
        </div>
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
          <dt>Available</dt>
          <dd>{ticketType.availableQuantity.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{ticketType.reservedQuantity.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Sold</dt>
          <dd>{ticketType.soldQuantity.toLocaleString()}</dd>
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
  disabled,
  error,
  id,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
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
            disabled={disabled}
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
