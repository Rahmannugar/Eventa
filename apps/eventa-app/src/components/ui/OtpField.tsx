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
      className="otp-field__slot"
      data-active={isActive ? 'true' : undefined}
    >
      <span className="otp-field__character">{char ?? placeholderChar}</span>
      {hasFakeCaret ? <span className="otp-field__caret" /> : null}
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
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <OTPInput
        id={id}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
        autoComplete="one-time-code"
        containerClassName="otp-field"
        disabled={disabled}
        inputMode="numeric"
        maxLength={6}
        onChange={onChange}
        pattern={REGEXP_ONLY_DIGITS}
        value={value}
        render={({ slots }) => (
          <span className="otp-field__group" aria-hidden="true">
            {slots.map((slot, index) => (
              <OtpSlot key={index} {...slot} />
            ))}
          </span>
        )}
      />
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
