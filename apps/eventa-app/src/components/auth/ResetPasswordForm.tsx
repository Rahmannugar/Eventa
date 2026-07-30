import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { userFacingApiError } from '../../lib/api/api-error';
import type { Actor } from '../../lib/auth/auth.types';
import { resetPasswordSchema } from '../../lib/auth/auth.validation';
import { useResetPassword } from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { OtpField } from '../ui/OtpField';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';

interface FormErrors {
  code?: string;
  email?: string;
  newPassword?: string;
}

function emailFromState(state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'email' in state &&
    typeof state.email === 'string'
  ) {
    return state.email;
  }

  return '';
}

export function ResetPasswordForm({ actor }: { actor: Actor }) {
  const location = useLocation();
  const navigate = useNavigate();
  const reset = useResetPassword(actor);
  const [email, setEmail] = useState(() => emailFromState(location.state));
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = resetPasswordSchema.safeParse({
      code,
      email,
      newPassword,
    });

    if (!result.success) {
      const nextErrors: FormErrors = {};

      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (
          (field === 'code' ||
            field === 'email' ||
            field === 'newPassword') &&
          nextErrors[field] === undefined
        ) {
          nextErrors[field] = issue.message;
        }
      }

      setErrors(nextErrors);
      return;
    }

    setErrors({});

    try {
      await reset.mutateAsync(result.data);
      toast.success('Password reset', {
        description: 'Sign in with your new password.',
      });
      void navigate(`/${actor}/login`, {
        replace: true,
        state: {
          email: result.data.email,
          passwordReset: true,
        },
      });
    } catch (error) {
      toast.error('Could not reset password', {
        description: userFacingApiError(error),
      });
    }
  }

  return (
    <>
      <div className="auth-heading">
        <h2>Choose a new password</h2>
        <p>Enter the six-digit reset code and your new password.</p>
      </div>

      <form
        className="login-form"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <TextField
          id={`${actor}-reset-email`}
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={
            actor === 'admin' ? 'organizer@example.com' : 'you@example.com'
          }
          value={email}
          error={errors.email}
          onChange={(event) => {
            setEmail(event.target.value);
            reset.reset();
          }}
        />

        <OtpField
          id={`${actor}-reset-code`}
          label="Reset code"
          disabled={reset.isPending}
          value={code}
          error={errors.code}
          onChange={(value) => {
            setCode(value);
            reset.reset();
          }}
        />

        <PasswordField
          id={`${actor}-new-password`}
          label="New password"
          autoComplete="new-password"
          value={newPassword}
          error={errors.newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value);
            reset.reset();
          }}
        />

        <Button
          type="submit"
          busy={reset.isPending}
          className="login-form__submit"
        >
          {reset.isPending ? 'Resetting password…' : 'Reset password'}
        </Button>
      </form>

      <p className="auth-form-link auth-form-link--split">
        <Link to={`/${actor}/forgot-password`}>Send another code</Link>
        <Link to={`/${actor}/login`}>Back to sign in</Link>
      </p>
    </>
  );
}
