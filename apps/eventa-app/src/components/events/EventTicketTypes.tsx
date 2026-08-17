import { PlusIcon, TicketIcon } from '@phosphor-icons/react';
import {
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { isSessionInvalid } from '../../lib/api/api-error';
import type {
  AdminEvent,
  EventTicketCurrency,
  EventTicketType,
} from '../../lib/events/event.types';
import {
  emptyTicketTypeForm,
  formatCapacityTotal,
  formatPriceInput,
  type TicketTypeFormState,
  validateTicketType,
} from '../../lib/events/event-ticket-type-form';
import { isoToLocalDateTime } from '../../lib/events/event.validation';
import {
  useCreateEventTicketType,
  useDefineEventTicketCurrency,
  useEventTicketTypes,
  useRetireEventTicketType,
  useUpdateEventTicketType,
} from '../../lib/events/useEvents';
import { Button } from '../ui/Button';
import {
  MutationError,
  TicketTypeCard,
  TicketTypeForm,
} from './EventTicketTypeControls';

const currencies = Intl.supportedValuesOf('currency');

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
  const updateTicketType = useUpdateEventTicketType();
  const retireTicketType = useRetireEventTicketType();
  const [definingCurrency, setDefiningCurrency] = useState(false);
  const [currency, setCurrency] = useState('');
  const [addingToCurrencyId, setAddingToCurrencyId] = useState<string>();
  const [editingTicketTypeId, setEditingTicketTypeId] = useState<string>();
  const [retiringTicketTypeId, setRetiringTicketTypeId] = useState<string>();
  const [form, setForm] = useState<TicketTypeFormState>(emptyTicketTypeForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const ticketCurrencies = catalogue.data?.ticketCurrencies ?? [];
  const canChange = event.status === 'draft';
  const canAddTicketType =
    canChange && (catalogue.data?.ticketTypes.length ?? 0) < 20;
  const sessionError =
    catalogue.error ??
    createTicketType.error ??
    defineCurrency.error ??
    updateTicketType.error ??
    retireTicketType.error;

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
    } catch {
      // The currency form owns recoverable mutation errors.
    } finally {
      onOperationChange(false);
    }
  }

  async function submitTicketType(
    submission: FormEvent<HTMLFormElement>,
    ticketCurrency: EventTicketCurrency,
  ) {
    submission.preventDefault();
    const validation = validateTicketType(
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
    } catch {
      // The ticket form owns recoverable mutation errors.
    } finally {
      onOperationChange(false);
    }
  }

  async function submitTicketTypeUpdate(
    submission: FormEvent<HTMLFormElement>,
    ticketCurrency: EventTicketCurrency,
    ticketType: EventTicketType,
  ) {
    submission.preventDefault();
    const validation = validateTicketType(
      form,
      ticketCurrency.currency,
      event.timeZone,
      event.startsAt,
    );
    if (validation.errors !== undefined) {
      setErrors(validation.errors);
      return;
    }
    const committed = ticketType.reservedQuantity + ticketType.soldQuantity;
    if (validation.capacity < committed) {
      setErrors({
        capacity: `Capacity cannot be lower than ${committed.toLocaleString()}.`,
      });
      return;
    }
    setErrors({});
    onOperationChange(true);
    try {
      await updateTicketType.mutateAsync({
        eventId: event.eventId,
        ticketTypeId: ticketType.ticketTypeId,
        input: {
          capacity: validation.capacity,
          ...(form.description.trim() === ''
            ? {}
            : { description: form.description.trim() }),
          expectedVersion: event.version,
          name: form.name.trim().replace(/\s+/g, ' '),
          priceMinor:
            committed > 0 ? ticketType.priceMinor : validation.priceMinor,
          salesEndAt:
            committed > 0 ? ticketType.salesEndAt : validation.salesEndAt,
          salesStartAt:
            committed > 0 ? ticketType.salesStartAt : validation.salesStartAt,
        },
      });
      setEditingTicketTypeId(undefined);
      setForm(emptyTicketTypeForm);
    } catch {
      // The ticket form owns recoverable mutation errors.
    } finally {
      onOperationChange(false);
    }
  }

  async function retireSelectedTicketType(ticketType: EventTicketType) {
    onOperationChange(true);
    try {
      await retireTicketType.mutateAsync({
        eventId: event.eventId,
        expectedVersion: event.version,
        ticketTypeId: ticketType.ticketTypeId,
      });
      setRetiringTicketTypeId(undefined);
    } catch {
      // The retirement confirmation owns recoverable mutation errors.
    } finally {
      onOperationChange(false);
    }
  }

  function beginEditing(ticketType: EventTicketType, currency: string) {
    updateTicketType.reset();
    retireTicketType.reset();
    setRetiringTicketTypeId(undefined);
    setErrors({});
    setForm({
      capacity: String(ticketType.capacity),
      description: ticketType.description ?? '',
      name: ticketType.name,
      price: formatPriceInput(ticketType.priceMinor, currency),
      salesEndAt:
        event.timeZone === undefined
          ? ''
          : isoToLocalDateTime(ticketType.salesEndAt, event.timeZone),
      salesStartAt:
        event.timeZone === undefined
          ? ''
          : isoToLocalDateTime(ticketType.salesStartAt, event.timeZone),
    });
    setEditingTicketTypeId(ticketType.ticketTypeId);
  }

  function resetForms() {
    setAddingToCurrencyId(undefined);
    setDefiningCurrency(false);
    setEditingTicketTypeId(undefined);
    setRetiringTicketTypeId(undefined);
    setCurrency('');
    setForm(emptyTicketTypeForm);
    setErrors({});
    createTicketType.reset();
    defineCurrency.reset();
    updateTicketType.reset();
    retireTicketType.reset();
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
        {canChange &&
        !definingCurrency &&
        addingToCurrencyId === undefined &&
        editingTicketTypeId === undefined &&
        retiringTicketTypeId === undefined ? (
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
                    editingTicketTypeId === undefined &&
                    retiringTicketTypeId === undefined &&
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
                        <div
                          className="ticket-type-entry"
                          key={ticketType.ticketTypeId}
                        >
                          <TicketTypeCard
                            currency={ticketCurrency.currency}
                            disabled={
                              disabled ||
                              editingTicketTypeId !== undefined ||
                              retiringTicketTypeId !== undefined ||
                              addingToCurrencyId !== undefined ||
                              definingCurrency
                            }
                            ticketType={ticketType}
                            timeZone={event.timeZone}
                            onEdit={() =>
                              beginEditing(ticketType, ticketCurrency.currency)
                            }
                            onRetire={() => {
                              updateTicketType.reset();
                              retireTicketType.reset();
                              setRetiringTicketTypeId(ticketType.ticketTypeId);
                            }}
                          />
                          {editingTicketTypeId === ticketType.ticketTypeId ? (
                            <TicketTypeForm
                              currency={ticketCurrency.currency}
                              commercialTermsLocked={
                                ticketType.reservedQuantity +
                                  ticketType.soldQuantity >
                                0
                              }
                              disabled={disabled}
                              errors={errors}
                              form={form}
                              idPrefix={`ticket-type-edit-${ticketType.ticketTypeId}`}
                              pending={updateTicketType.isPending}
                              error={updateTicketType.error}
                              submitLabel="Save changes"
                              onCancel={resetForms}
                              onChange={setForm}
                              onReload={reload}
                              onResetError={updateTicketType.reset}
                              onSubmit={(submission) => {
                                void submitTicketTypeUpdate(
                                  submission,
                                  ticketCurrency,
                                  ticketType,
                                );
                              }}
                            />
                          ) : null}
                          {retiringTicketTypeId === ticketType.ticketTypeId ? (
                            <div
                              className="ticket-type-retirement"
                              role="alert"
                            >
                              <p>
                                Remove <strong>{ticketType.name}</strong> from
                                sale?
                              </p>
                              {retireTicketType.error === null ? null : (
                                <MutationError
                                  error={retireTicketType.error}
                                  reload={reload}
                                  reset={retireTicketType.reset}
                                />
                              )}
                              <div className="ticket-type-form__actions">
                                <Button
                                  type="button"
                                  variant="quiet"
                                  disabled={retireTicketType.isPending}
                                  onClick={resetForms}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  variant="danger"
                                  busy={retireTicketType.isPending}
                                  disabled={disabled}
                                  onClick={() => {
                                    void retireSelectedTicketType(ticketType);
                                  }}
                                >
                                  Remove ticket type
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {addingToCurrencyId === ticketCurrency.ticketCurrencyId ? (
                    <TicketTypeForm
                      currency={ticketCurrency.currency}
                      commercialTermsLocked={false}
                      disabled={disabled}
                      errors={errors}
                      form={form}
                      idPrefix={`ticket-type-create-${ticketCurrency.ticketCurrencyId}`}
                      pending={createTicketType.isPending}
                      error={createTicketType.error}
                      onCancel={resetForms}
                      onChange={setForm}
                      onReload={reload}
                      onResetError={createTicketType.reset}
                      submitLabel="Add ticket type"
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
