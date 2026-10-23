import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string | undefined;
  label: string;
}

export function TextField({ error, id, label, ...props }: TextFieldProps) {
  const errorId = `${String(id)}-error`;

  return (
    <div className="grid gap-2">
      <label className="text-[.79rem] font-bold" htmlFor={id}>{label}</label>
      <input
        className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3.5 py-3 text-[.94rem] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] hover:border-[var(--muted)] focus:border-[var(--focus)] focus:ring-2 focus:ring-[var(--focus)]/20 aria-invalid:border-[var(--danger)]"
        {...props}
        id={id}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-invalid={error === undefined ? undefined : true}
      />
      {error === undefined ? null : (
        <p className="text-xs font-semibold leading-normal text-[var(--danger)]" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
