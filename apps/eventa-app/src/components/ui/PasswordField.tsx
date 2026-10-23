import { EyeIcon, EyeSlashIcon } from '@phosphor-icons/react';
import { useState, type InputHTMLAttributes } from 'react';

interface PasswordFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string | undefined;
  label: string;
}

export function PasswordField({
  error,
  id,
  label,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const errorId = `${String(id)}-error`;

  return (
    <div className="grid gap-2">
      <label className="text-[.79rem] font-bold" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-3 pr-12 text-[.94rem] text-[var(--ink)] outline-none transition-colors hover:border-[var(--muted)] focus:border-[var(--focus)] focus:ring-2 focus:ring-[var(--focus)]/20 aria-invalid:border-[var(--danger)]"
          {...props}
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={error === undefined ? undefined : errorId}
          aria-invalid={error === undefined ? undefined : true}
        />
        <button
          type="button"
          className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--ink)]"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current);
          }}
        >
          {visible ? <EyeSlashIcon /> : <EyeIcon />}
        </button>
      </div>
      {error === undefined ? null : (
        <p className="text-xs font-semibold leading-normal text-[var(--danger)]" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
