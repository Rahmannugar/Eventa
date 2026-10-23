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
    <form className="mt-5 grid gap-5 border-t border-border pt-5" onSubmit={onSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
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
        <p className="text-sm text-[var(--muted)]">
          Price and sales dates cannot change after tickets are reserved or
          sold.
        </p>
      ) : null}
      <label className="grid gap-2 [&>label]:text-[13px] [&>label]:font-bold" htmlFor={`${idPrefix}-description`}>
        <span className="text-[13px] font-bold">
          Description <small className="font-normal text-[var(--muted)]">Optional</small>
        </span>
        <textarea
          id={`${idPrefix}-description`}
          className="min-h-24 w-full resize-y rounded-xl border border-border bg-[var(--paper)] px-3.5 py-3 text-sm leading-relaxed text-[var(--ink)] hover:border-[var(--focus)] focus:border-[var(--focus)] focus:outline-none"
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
      <div className="flex flex-wrap justify-end gap-3">
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
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3.5 text-sm font-semibold leading-normal text-[var(--danger)]" role="alert">
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
    <article className="grid gap-4 rounded-xl border border-border bg-[var(--canvas)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 [&_p]:mt-1 [&_p]:text-[var(--muted)]">
        <div>
          <h4>{ticketType.name}</h4>
          {ticketType.description === undefined ? null : (
            <p>{ticketType.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2">
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
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 [&_dt]:mb-1 [&_dt]:text-xs [&_dt]:font-bold [&_dt]:tracking-wide [&_dt]:text-[var(--muted)] [&_dt]:uppercase [&_dd]:font-semibold">
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
    <div className="grid gap-2 [&>label]:text-[13px] [&>label]:font-bold">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <ByteDateTimePicker
        className="block [&_.byte-dropdown]:border [&_.byte-cell]:min-h-11 [&_.byte-nav-btn]:min-h-11 [&_.byte-header-title]:min-h-11 [&_.byte-action-btn]:min-h-11 [&_.byte-time-field_select]:min-h-11"
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
            className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-border bg-[var(--paper)] px-3.5 py-3 text-left text-[var(--ink)] hover:border-[var(--focus)] aria-invalid:border-[var(--danger)] disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--muted)] [&>span]:truncate"
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
      {error === undefined ? null : <p className="text-xs font-semibold leading-normal text-[var(--danger)]">{error}</p>}
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
