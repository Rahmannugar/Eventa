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
        className={`button button--${variant} ${className}`.trim()}
        disabled={disabled === true || busy}
        aria-busy={busy}
        {...props}
      >
        {children}
      </button>
    );
  },
);
