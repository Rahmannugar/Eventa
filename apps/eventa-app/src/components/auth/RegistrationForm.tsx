import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import { registerAttendeeSchema } from '../../lib/auth/auth.validation';
import { useRegisterAttendee } from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';

interface FormErrors {
  email?: string;
  password?: string;
  username?: string;
}

export function RegistrationForm() {
  const navigate = useNavigate();
  const registration = useRegisterAttendee();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = registerAttendeeSchema.safeParse({
      email,
      password,
      username,
    });

    if (!result.success) {
      const nextErrors: FormErrors = {};

      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (
          (field === 'email' || field === 'password' || field === 'username') &&
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
      const account = await registration.mutateAsync(result.data);
      void navigate('/attendee/verify-email', {
        replace: true,
        state: { email: account.email },
      });
    } catch {
      // The normalized request error remains visible in the form.
    }
  }

  return (
    <>
      <div className="auth-heading">
        <h2>Create account</h2>
        <p>Enter your details to create an attendee account.</p>
      </div>

      <form
        className="login-form"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <TextField
          id="attendee-username"
          label="Username"
          type="text"
          autoComplete="username"
          placeholder="eventer"
          value={username}
          error={errors.username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
        />

        <TextField
          id="attendee-registration-email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          error={errors.email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />

        <PasswordField
          id="attendee-registration-password"
          label="Password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />

        {registration.error === null ? null : (
          <div className="form-alert" role="alert" aria-live="assertive">
            {userFacingApiError(registration.error)}
          </div>
        )}

        <Button
          type="submit"
          busy={registration.isPending}
          className="login-form__submit"
        >
          {registration.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="auth-form-link">
        Already have an account? <Link to="/attendee/login">Sign in</Link>
      </p>
    </>
  );
}
