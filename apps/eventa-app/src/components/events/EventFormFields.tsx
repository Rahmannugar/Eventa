import * as Popover from '@radix-ui/react-popover';
import {
  CalendarBlankIcon,
  CaretDownIcon,
  CheckIcon,
  MapPinIcon,
  PlusIcon,
  TagIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Command } from 'cmdk';
import { format, isValid, parse } from 'date-fns';
import {
  useId,
  useMemo,
  useState,
  type Dispatch,
  type TextareaHTMLAttributes,
} from 'react';
import { DayPicker } from 'react-day-picker';
import { getData } from 'country-list';

import type {
  DraftEventFormErrors,
  DraftEventFormValues,
} from '../../lib/events/event.validation';
import { TextField } from '../ui/TextField';

const categorySuggestions = [
  'Arts & Culture',
  'Business',
  'Community',
  'Education',
  'Food & Drink',
  'Health & Wellness',
  'Music',
  'Networking',
  'Outdoors',
  'Sports',
  'Technology',
];

const countries = getData()
  .map(({ code, name }) => ({ label: name, value: code }))
  .sort((first, second) => first.label.localeCompare(second.label));

const fallbackTimeZones = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Johannesburg',
  'America/Chicago',
  'America/Los_Angeles',
  'America/New_York',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'UTC',
];

/* ESLint's base unused-vars rule does not distinguish TypeScript function parameters. */
/* eslint-disable no-unused-vars */
type SupportedValuesOf = (key: 'timeZone') => string[];
type EventFormChange = <K extends keyof DraftEventFormValues>(
  field: K,
  value: DraftEventFormValues[K],
) => void;
/* eslint-enable no-unused-vars */

function timeZoneOptions(): Array<{ label: string; value: string }> {
  try {
    const supportedValuesOf = (
      Intl as typeof Intl & { supportedValuesOf?: SupportedValuesOf }
    ).supportedValuesOf;
    return (supportedValuesOf?.('timeZone') ?? fallbackTimeZones).map(
      (value) => ({ label: value.replaceAll('_', ' '), value }),
    );
  } catch {
    return fallbackTimeZones.map((value) => ({ label: value, value }));
  }
}

export function EventFormFields({
  errors,
  idPrefix,
  onChange,
  values,
}: {
  errors: DraftEventFormErrors;
  idPrefix: string;
  onChange: EventFormChange;
  values: DraftEventFormValues;
}) {
  const timeZones = useMemo(() => timeZoneOptions(), []);

  return (
    <>
      <section
        className="event-form__section"
        aria-labelledby={`${idPrefix}-about-title`}
      >
        <div className="event-form__section-heading">
          <TagIcon aria-hidden="true" />
          <h2 id={`${idPrefix}-about-title`}>About</h2>
        </div>
        <div className="event-form__fields">
          <TextField
            id={`${idPrefix}-title`}
            label="Event title"
            maxLength={160}
            autoComplete="off"
            value={values.title}
            error={errors.title}
            onChange={(input) => onChange('title', input.target.value)}
          />
          <TextAreaField
            id={`${idPrefix}-description`}
            label="Description"
            maxLength={10_000}
            rows={7}
            value={values.description}
            error={errors.description}
            onChange={(input) => onChange('description', input.target.value)}
          />
          <CategoryMultiSelect
            id={`${idPrefix}-categories`}
            values={values.categories}
            error={errors.categories}
            onChange={(categories) => onChange('categories', categories)}
          />
        </div>
      </section>

      <section
        className="event-form__section"
        aria-labelledby={`${idPrefix}-schedule-title`}
      >
        <div className="event-form__section-heading">
          <CalendarBlankIcon aria-hidden="true" />
          <h2 id={`${idPrefix}-schedule-title`}>Date and time</h2>
        </div>
        <div className="event-form__fields">
          <div className="event-form__grid">
            <DateTimeField
              id={`${idPrefix}-starts-at`}
              label="Starts"
              value={values.startsAt}
              error={errors.startsAt}
              onChange={(value) => onChange('startsAt', value)}
            />
            <DateTimeField
              id={`${idPrefix}-ends-at`}
              label="Ends"
              value={values.endsAt}
              error={errors.endsAt}
              onChange={(value) => onChange('endsAt', value)}
            />
          </div>
          <SearchSelect
            id={`${idPrefix}-time-zone`}
            label="Time zone"
            options={timeZones}
            value={values.timeZone}
            error={errors.timeZone}
            placeholder="Choose a time zone"
            onChange={(value) => onChange('timeZone', value)}
          />
        </div>
      </section>

      <section
        className="event-form__section"
        aria-labelledby={`${idPrefix}-venue-title`}
      >
        <div className="event-form__section-heading">
          <MapPinIcon aria-hidden="true" />
          <h2 id={`${idPrefix}-venue-title`}>Venue</h2>
        </div>
        <div className="event-form__fields">
          <TextField
            id={`${idPrefix}-venue-name`}
            label="Venue name"
            maxLength={160}
            autoComplete="organization"
            value={values.venueName}
            error={errors.venueName}
            onChange={(input) => onChange('venueName', input.target.value)}
          />
          <TextField
            id={`${idPrefix}-address-one`}
            label="Address line 1"
            maxLength={200}
            autoComplete="address-line1"
            value={values.addressLine1}
            error={errors.addressLine1}
            onChange={(input) => onChange('addressLine1', input.target.value)}
          />
          <TextField
            id={`${idPrefix}-address-two`}
            label="Address line 2 (optional)"
            maxLength={200}
            autoComplete="address-line2"
            value={values.addressLine2}
            error={errors.addressLine2}
            onChange={(input) => onChange('addressLine2', input.target.value)}
          />
          <div className="event-form__grid event-form__grid--address">
            <TextField
              id={`${idPrefix}-city`}
              label="City"
              maxLength={120}
              autoComplete="address-level2"
              value={values.city}
              error={errors.city}
              onChange={(input) => onChange('city', input.target.value)}
            />
            <TextField
              id={`${idPrefix}-region`}
              label="State or region (optional)"
              maxLength={120}
              autoComplete="address-level1"
              value={values.region}
              error={errors.region}
              onChange={(input) => onChange('region', input.target.value)}
            />
            <TextField
              id={`${idPrefix}-postal-code`}
              label="Postal code (optional)"
              maxLength={32}
              autoComplete="postal-code"
              value={values.postalCode}
              error={errors.postalCode}
              onChange={(input) => onChange('postalCode', input.target.value)}
            />
            <SearchSelect
              id={`${idPrefix}-country`}
              label="Country"
              options={countries}
              value={values.countryCode}
              error={errors.countryCode}
              placeholder="Choose a country"
              onChange={(value) => onChange('countryCode', value)}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function CategoryMultiSelect({
  error,
  id,
  onChange,
  values,
}: {
  error?: string | undefined;
  id: string;
  onChange: Dispatch<string[]>;
  values: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const errorId = `${id}-error`;
  const normalizedSearch = search.trim();
  const alreadySelected = values.some(
    (value) =>
      value.toLocaleLowerCase() === normalizedSearch.toLocaleLowerCase(),
  );

  function add(value: string) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (
      normalized === '' ||
      values.length >= 5 ||
      values.some(
        (item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
      )
    ) {
      return;
    }
    onChange([...values, normalized]);
    setSearch('');
  }

  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>
        Categories
      </label>
      <div className="multi-select__control">
        {values.length === 0 ? null : (
          <div
            className="multi-select__values"
            aria-label="Selected categories"
          >
            {values.map((value) => (
              <span className="category-chip" key={value}>
                {value}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  onClick={() =>
                    onChange(values.filter((item) => item !== value))
                  }
                >
                  <XIcon aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              id={id}
              type="button"
              className="multi-select__trigger"
              aria-labelledby={`${id}-label`}
              aria-describedby={error === undefined ? undefined : errorId}
              aria-invalid={error === undefined ? undefined : true}
            >
              <span className="select-placeholder">
                {values.length === 0
                  ? 'Choose or type categories'
                  : 'Add category'}
              </span>
              <CaretDownIcon aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="select-popover"
              align="start"
              sideOffset={6}
            >
              <Command shouldFilter>
                <Command.Input
                  autoFocus
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search or type a category"
                  aria-label="Search categories"
                />
                <Command.List>
                  <Command.Empty>
                    {normalizedSearch === ''
                      ? 'No categories found.'
                      : 'Create this category below.'}
                  </Command.Empty>
                  {normalizedSearch !== '' &&
                  !alreadySelected &&
                  values.length < 5 ? (
                    <Command.Item
                      value={`create ${normalizedSearch}`}
                      onSelect={() => add(normalizedSearch)}
                    >
                      <PlusIcon aria-hidden="true" />
                      Add “{normalizedSearch}”
                    </Command.Item>
                  ) : null}
                  {categorySuggestions.map((category) => (
                    <Command.Item
                      disabled={values.includes(category) || values.length >= 5}
                      key={category}
                      value={category}
                      onSelect={() => add(category)}
                    >
                      <CheckIcon
                        aria-hidden="true"
                        className={values.includes(category) ? '' : 'is-hidden'}
                      />
                      {category}
                    </Command.Item>
                  ))}
                </Command.List>
              </Command>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <small className="field__hint">Choose up to five.</small>
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
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
  const [open, setOpen] = useState(false);
  const [datePart = '', timePart = ''] = value.split('T');
  const selected =
    datePart === '' ? undefined : parse(datePart, 'yyyy-MM-dd', new Date());
  const errorId = `${id}-error`;

  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div
        className="date-time-field"
        aria-describedby={error === undefined ? undefined : errorId}
      >
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              id={id}
              type="button"
              className="date-picker__trigger"
              aria-labelledby={`${id}-label`}
              aria-describedby={error === undefined ? undefined : errorId}
              aria-invalid={error === undefined ? undefined : true}
            >
              <CalendarBlankIcon aria-hidden="true" />
              {selected !== undefined && isValid(selected) ? (
                format(selected, 'EEE, d MMM yyyy')
              ) : (
                <span className="select-placeholder">Choose date</span>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="calendar-popover"
              align="start"
              sideOffset={6}
            >
              <DayPicker
                mode="single"
                {...(selected === undefined
                  ? {}
                  : { selected, defaultMonth: selected })}
                onSelect={(date) => {
                  if (date === undefined) return;
                  onChange(
                    `${format(date, 'yyyy-MM-dd')}T${timePart || '09:00'}`,
                  );
                  setOpen(false);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <input
          aria-label={`${label} time`}
          aria-describedby={error === undefined ? undefined : errorId}
          type="time"
          value={timePart}
          aria-invalid={error === undefined ? undefined : true}
          onChange={(event) => {
            const date = datePart || format(new Date(), 'yyyy-MM-dd');
            onChange(`${date}T${event.target.value}`);
          }}
        />
      </div>
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

function SearchSelect({
  error,
  id,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  error?: string | undefined;
  id: string;
  label: string;
  onChange: Dispatch<string>;
  options: Array<{ label: string; value: string }>;
  placeholder: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const errorId = `${id}-error`;
  const selected = options.find((option) => option.value === value);

  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className="search-select__trigger"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={`${id}-label`}
            aria-describedby={error === undefined ? undefined : errorId}
            aria-invalid={error === undefined ? undefined : true}
          >
            <span
              className={selected === undefined ? 'select-placeholder' : ''}
            >
              {selected?.label ?? placeholder}
            </span>
            <CaretDownIcon aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="select-popover"
            align="start"
            sideOffset={6}
          >
            <Command>
              <Command.Input
                autoFocus
                placeholder={`Search ${label.toLocaleLowerCase()}`}
                aria-label={`Search ${label.toLocaleLowerCase()}`}
              />
              <Command.List>
                <Command.Empty>No matches found.</Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={option.value === value ? '' : 'is-hidden'}
                    />
                    {option.label}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

function TextAreaField({
  error,
  id,
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string | undefined;
  label: string;
}) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;
  const errorId = `${resolvedId}-error`;
  return (
    <div className="field">
      <label htmlFor={resolvedId}>{label}</label>
      <textarea
        {...props}
        id={resolvedId}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
      />
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
