import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import type { Actor } from '../../lib/auth/auth.types';
import { loginSchema } from '../../lib/auth/auth.validation';
import { useLogin } from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';

interface FormErrors {
  email?: string;
  password?: string;
}

function safeDestination(actor: Actor, state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string' &&
    (state.from === `/${actor}` || state.from.startsWith(`/${actor}/`))
  ) {
    return state.from;
  }

  return `/${actor}`;
}

export function LoginForm({ actor }: { actor: Actor }) {
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin(actor);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = loginSchema.safeParse({ email, password });

    if (!result.success) {
      const nextErrors: FormErrors = {};

      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field === 'email' && nextErrors.email === undefined) {
          nextErrors.email = issue.message;
        }
        if (field === 'password' && nextErrors.password === undefined) {
          nextErrors.password = issue.message;
        }
      }

      setErrors(nextErrors);
      return;
    }

    setErrors({});

    try {
      await login.mutateAsync(result.data);
      void navigate(safeDestination(actor, location.state), { replace: true });
    } catch {
      // The mutation exposes its normalized error in the form's live region.
    }
  }

  return (
    <>
      <div className="auth-heading">
        <h2>Sign in</h2>
        <p>
          {actor === 'admin'
            ? 'Use your approved organizer account.'
            : 'Sign in to your Eventa account.'}
        </p>
      </div>

      <form
        className="login-form"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <TextField
          id={`${actor}-email`}
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
          }}
        />

        <PasswordField
          id={`${actor}-password`}
          label="Password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />

        {login.error === null ? null : (
          <div className="form-alert" role="alert" aria-live="assertive">
            {userFacingApiError(login.error)}
          </div>
        )}

        <Button
          type="submit"
          busy={login.isPending}
          className="login-form__submit"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </>
  );
}
