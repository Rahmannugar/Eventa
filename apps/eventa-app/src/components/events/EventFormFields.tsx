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
import { ByteDateTimePicker } from 'byte-datepicker';
import { Command } from 'cmdk';
import {
  useId,
  useMemo,
  useState,
  type Dispatch,
  type TextareaHTMLAttributes,
} from 'react';
import type {
  DraftEventFormErrors,
  DraftEventFormValues,
} from '../../lib/events/event.validation';
import {
  countryOptions,
  regionNameForCode,
  regionOptions,
} from '../../lib/location/location-data';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { EventVenueMap } from './EventVenueMap';

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
  const regions = useMemo(
    () => regionOptions(values.countryCode),
    [values.countryCode],
  );

  return (
    <>
      <section
        className="overflow-hidden rounded-2xl border border-border bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
        aria-labelledby={`${idPrefix}-about-title`}
      >
        <div className="flex items-start gap-3.5 border-b border-border px-5 py-4 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:text-[var(--evergreen)] [&_h2]:text-base [&_p]:mt-1 [&_p]:text-xs [&_p]:leading-normal [&_p]:text-[var(--muted)]">
          <TagIcon aria-hidden="true" />
          <h2 id={`${idPrefix}-about-title`}>About</h2>
        </div>
        <div className="grid gap-5 p-5 sm:p-6">
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
        className="overflow-hidden rounded-2xl border border-border bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
        aria-labelledby={`${idPrefix}-schedule-title`}
      >
        <div className="flex items-start gap-3.5 border-b border-border px-5 py-4 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:text-[var(--evergreen)] [&_h2]:text-base [&_p]:mt-1 [&_p]:text-xs [&_p]:leading-normal [&_p]:text-[var(--muted)]">
          <CalendarBlankIcon aria-hidden="true" />
          <h2 id={`${idPrefix}-schedule-title`}>Date and time</h2>
        </div>
        <div className="grid gap-5 p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
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
        className="overflow-hidden rounded-2xl border border-border bg-[var(--paper)] shadow-[0_10px_35px_rgb(23_35_29_/_4%)]"
        aria-labelledby={`${idPrefix}-venue-title`}
      >
        <div className="flex items-start gap-3.5 border-b border-border px-5 py-4 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:text-[var(--evergreen)] [&_h2]:text-base [&_p]:mt-1 [&_p]:text-xs [&_p]:leading-normal [&_p]:text-[var(--muted)]">
          <MapPinIcon aria-hidden="true" />
          <h2 id={`${idPrefix}-venue-title`}>Venue</h2>
        </div>
        <div className="grid gap-5 p-5 sm:p-6">
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
          <div className="grid gap-5 sm:grid-cols-2">
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
              options={countryOptions}
              value={values.countryCode}
              error={errors.countryCode}
              placeholder="Choose a country"
              onChange={(value) => {
                onChange('countryCode', value);
                onChange('region', '');
                onChange('regionCode', '');
              }}
            />
            {regions.length === 0 ? (
              <TextField
                id={`${idPrefix}-region`}
                label="State or region (optional)"
                maxLength={120}
                autoComplete="address-level1"
                disabled={values.countryCode === ''}
                value={values.region}
                error={errors.region}
                onChange={(input) => {
                  onChange('region', input.target.value);
                  onChange('regionCode', '');
                }}
              />
            ) : (
              <SearchSelect
                id={`${idPrefix}-region`}
                label="State or region (optional)"
                options={[
                  { label: 'No state or region', value: '' },
                  ...regions,
                ]}
                value={values.regionCode}
                fallbackLabel={values.region}
                error={errors.region}
                placeholder="Choose a state or region"
                onChange={(value) => {
                  onChange('regionCode', value);
                  onChange(
                    'region',
                    value === ''
                      ? ''
                      : regionNameForCode(values.countryCode, value),
                  );
                }}
              />
            )}
          </div>

          <div className="grid gap-4">
            <div
              aria-label="Venue location map"
              className="h-76 overflow-hidden rounded-xl border border-border bg-[#e8e6df] [&_.leaflet-container]:size-full [&_.leaflet-container]:bg-[#e8e6df] [&_.leaflet-control-attribution]:text-[10px]"
              role="group"
            >
              <EventVenueMap
                onPick={(latitude, longitude) => {
                  onChange('latitude', String(latitude));
                  onChange('longitude', String(longitude));
                }}
                point={venuePoint(values)}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                id={`${idPrefix}-latitude`}
                label="Latitude (optional)"
                autoComplete="off"
                error={errors.latitude}
                inputMode="decimal"
                maxLength={11}
                onChange={(input) => onChange('latitude', input.target.value)}
                placeholder="6.5244"
                value={values.latitude}
              />
              <TextField
                id={`${idPrefix}-longitude`}
                label="Longitude (optional)"
                autoComplete="off"
                error={errors.longitude}
                inputMode="decimal"
                maxLength={11}
                onChange={(input) => onChange('longitude', input.target.value)}
                placeholder="3.3792"
                value={values.longitude}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <small className="text-[11px] text-[var(--muted)]">
                Click the map to mark the venue, or type coordinates — set both
                or neither.
              </small>
              {values.latitude === '' && values.longitude === '' ? null : (
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    onChange('latitude', '');
                    onChange('longitude', '');
                  }}
                >
                  Clear location
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// An invalid or half-typed coordinate simply places no pin: the map shows
// what is true, and the field's own error explains what to fix.
function venuePoint(values: DraftEventFormValues): {
  latitude: number | null;
  longitude: number | null;
} {
  return {
    latitude: parseCoordinate(values.latitude, 90),
    longitude: parseCoordinate(values.longitude, 180),
  };
}

function parseCoordinate(raw: string, bound: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && Math.abs(value) <= bound ? value : null;
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
    <div className="grid gap-2 [&>label]:text-[13px] [&>label]:font-bold">
      <label id={`${id}-label`} htmlFor={id}>
        Categories
      </label>
      <div className="grid gap-2">
        {values.length === 0 ? null : (
          <div
            className="flex min-w-0 flex-wrap gap-1.5"
            aria-label="Selected categories"
          >
            {values.map((value) => (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--soft)] px-2.5 py-1 text-xs font-bold text-[var(--evergreen)] [&_svg]:size-3" key={value}>
                {value}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  className="grid size-5 place-items-center rounded-full hover:bg-[var(--paper)]"
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
              className="flex min-h-12 w-full items-center justify-between gap-2.5 rounded-xl border border-border bg-[var(--paper)] px-3.5 py-3 text-left text-[var(--ink)] hover:border-[var(--focus)] aria-invalid:border-[var(--danger)] [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--muted)]"
              aria-labelledby={`${id}-label`}
              aria-describedby={error === undefined ? undefined : errorId}
              aria-invalid={error === undefined ? undefined : true}
            >
              <span className="text-[var(--muted)]">
                {values.length === 0
                  ? 'Choose or type categories'
                  : 'Add category'}
              </span>
              <CaretDownIcon aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="z-50 w-[var(--radix-popover-trigger-width)] min-w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-[var(--paper)] shadow-[0_18px_50px_rgb(23_35_29_/_16%)] [&_[cmdk-input]]:w-full [&_[cmdk-input]]:border-b [&_[cmdk-input]]:border-border [&_[cmdk-input]]:p-3.5 [&_[cmdk-list]]:max-h-68 [&_[cmdk-list]]:overflow-y-auto [&_[cmdk-list]]:p-1.5 [&_[cmdk-item]]:flex [&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2 [&_[cmdk-item]]:rounded-lg [&_[cmdk-item]]:p-2.5 [&_[cmdk-item]]:text-sm [&_[cmdk-item][data-selected=true]]:bg-[var(--soft)] [&_[cmdk-item][data-disabled=true]]:cursor-not-allowed [&_[cmdk-item][data-disabled=true]]:opacity-45 [&_[cmdk-empty]]:p-4 [&_[cmdk-empty]]:text-center [&_[cmdk-empty]]:text-xs [&_[cmdk-empty]]:text-[var(--muted)]"
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
      <small className="text-[11px] text-[var(--muted)]">Choose up to five.</small>
      {error === undefined ? null : (
        <p className="text-xs font-semibold leading-normal text-[var(--danger)]" id={errorId}>
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
  const errorId = `${id}-error`;

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
            aria-describedby={error === undefined ? undefined : errorId}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            aria-invalid={error === undefined ? undefined : true}
            aria-labelledby={`${id}-label`}
            onClick={open}
          >
            <CalendarBlankIcon aria-hidden="true" />
            {formattedValue === '' ? (
              <span className="text-[var(--muted)]">Choose date and time</span>
            ) : (
              <span>{formattedValue}</span>
            )}
          </button>
        )}
      </ByteDateTimePicker>
      {error === undefined ? null : (
        <p className="text-xs font-semibold leading-normal text-[var(--danger)]" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

function formatLocalDateTime(date: Date | null): string {
  if (date === null) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SearchSelect({
  error,
  fallbackLabel,
  disabled = false,
  id,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  error?: string | undefined;
  disabled?: boolean;
  fallbackLabel?: string | undefined;
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
    <div className="grid gap-2 [&>label]:text-[13px] [&>label]:font-bold">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            className="flex min-h-12 w-full items-center justify-between gap-2.5 rounded-xl border border-border bg-[var(--paper)] px-3.5 py-3 text-left text-[var(--ink)] hover:border-[var(--focus)] aria-invalid:border-[var(--danger)] disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--muted)]"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={`${id}-label`}
            aria-describedby={error === undefined ? undefined : errorId}
            aria-invalid={error === undefined ? undefined : true}
          >
            <span
              className={selected === undefined ? 'select-placeholder' : ''}
            >
              {selected?.label ?? fallbackLabel ?? placeholder}
            </span>
            <CaretDownIcon aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-50 w-[var(--radix-popover-trigger-width)] min-w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-[var(--paper)] shadow-[0_18px_50px_rgb(23_35_29_/_16%)] [&_[cmdk-input]]:w-full [&_[cmdk-input]]:border-b [&_[cmdk-input]]:border-border [&_[cmdk-input]]:p-3.5 [&_[cmdk-list]]:max-h-68 [&_[cmdk-list]]:overflow-y-auto [&_[cmdk-list]]:p-1.5 [&_[cmdk-item]]:flex [&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2 [&_[cmdk-item]]:rounded-lg [&_[cmdk-item]]:p-2.5 [&_[cmdk-item]]:text-sm [&_[cmdk-item][data-selected=true]]:bg-[var(--soft)] [&_[cmdk-item][data-disabled=true]]:cursor-not-allowed [&_[cmdk-item][data-disabled=true]]:opacity-45 [&_[cmdk-empty]]:p-4 [&_[cmdk-empty]]:text-center [&_[cmdk-empty]]:text-xs [&_[cmdk-empty]]:text-[var(--muted)]"
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
        <p className="text-xs font-semibold leading-normal text-[var(--danger)]" id={errorId}>
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
    <div className="grid gap-2 [&>label]:text-[13px] [&>label]:font-bold">
      <label htmlFor={resolvedId}>{label}</label>
      <textarea
        {...props}
        id={resolvedId}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
        className="min-h-32 w-full resize-y rounded-xl border border-border bg-[var(--paper)] px-3.5 py-3 text-sm leading-relaxed text-[var(--ink)] hover:border-[var(--focus)] focus:border-[var(--focus)] focus:outline-none aria-invalid:border-[var(--danger)]"
      />
      {error === undefined ? null : (
        <p className="text-xs font-semibold leading-normal text-[var(--danger)]" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
