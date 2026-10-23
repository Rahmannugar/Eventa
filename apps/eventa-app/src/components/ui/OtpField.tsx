import {
  OTPInput,
  REGEXP_ONLY_DIGITS,
  type OTPInputProps,
  type SlotProps,
} from 'input-otp';

interface OtpFieldProps {
  disabled?: boolean;
  error?: string | undefined;
  id: string;
  label: string;
  onChange: NonNullable<OTPInputProps['onChange']>;
  value: string;
}

function OtpSlot({ char, hasFakeCaret, isActive, placeholderChar }: SlotProps) {
  return (
    <span
      className="relative grid min-h-12 min-w-0 place-items-center border border-r-0 border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] font-bold tabular-nums first:rounded-l-xl last:rounded-r-xl last:border-r data-[active=true]:z-10 data-[active=true]:border-[var(--focus)] data-[active=true]:ring-2 data-[active=true]:ring-[var(--focus)]/20"
      data-active={isActive ? 'true' : undefined}
    >
      <span className="min-h-[1.25em]">{char ?? placeholderChar}</span>
      {hasFakeCaret ? <span className="absolute h-5 w-px animate-pulse bg-[var(--ink)]" /> : null}
    </span>
  );
}

export function OtpField({
  disabled = false,
  error,
  id,
  label,
  onChange,
  value,
}: OtpFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="grid gap-2">
      <label className="text-[.79rem] font-bold" htmlFor={id}>{label}</label>
      <OTPInput
        id={id}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
        autoComplete="one-time-code"
        containerClassName="relative flex w-full items-center disabled:opacity-60"
        disabled={disabled}
        inputMode="numeric"
        maxLength={6}
        onChange={onChange}
        pattern={REGEXP_ONLY_DIGITS}
        value={value}
        render={({ slots }) => (
          <span className="grid flex-1 grid-cols-6" aria-hidden="true">
            {slots.map((slot, index) => (
              <OtpSlot key={index} {...slot} />
            ))}
          </span>
        )}
      />
      {error === undefined ? null : (
        <p className="text-xs font-semibold text-[var(--danger)]" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
