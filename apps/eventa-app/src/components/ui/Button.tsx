import { forwardRef, type ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  variant?: 'danger' | 'primary' | 'secondary' | 'quiet';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      busy = false,
      children,
      className = '',
      disabled,
      variant = 'primary',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={`inline-flex min-h-11 items-center justify-center gap-2.5 rounded-xl border px-4 py-3 text-[.82rem] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variant === 'primary' ? 'border-transparent bg-[#0b5945] text-white hover:enabled:bg-[#073c31] dark:bg-[#83d5a9] dark:text-[#102018] dark:hover:enabled:bg-[#9de3bb]' : variant === 'secondary' ? 'border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:enabled:bg-[var(--soft)]' : variant === 'danger' ? 'border-[var(--danger)] bg-[var(--danger)] text-white hover:enabled:opacity-85' : 'border-transparent bg-transparent text-[var(--muted)] hover:enabled:bg-[var(--soft)]'} ${className}`.trim()}
        disabled={disabled === true || busy}
        aria-busy={busy}
        {...props}
      >
        {children}
      </button>
    );
  },
);
