import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
}

export function Button({
  busy = false,
  children,
  className = '',
  disabled,
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled === true || busy}
      aria-busy={busy}
      {...props}
    >
      {children}
    </button>
  );
}
