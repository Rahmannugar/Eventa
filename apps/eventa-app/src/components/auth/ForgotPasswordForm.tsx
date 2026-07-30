import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { userFacingApiError } from '../../lib/api/api-error';
import type { Actor } from '../../lib/auth/auth.types';
import { forgotPasswordSchema } from '../../lib/auth/auth.validation';
import { useForgotPassword } from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

export function ForgotPasswordForm({ actor }: { actor: Actor }) {
  const navigate = useNavigate();
  const request = useForgotPassword(actor);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = forgotPasswordSchema.safeParse({ email });

    if (!result.success) {
      setEmailError(
        result.error.issues[0]?.message ?? 'Enter a valid email address.',
      );
      return;
    }

    setEmailError(undefined);

    try {
      await request.mutateAsync(result.data);
      toast.success('Reset code requested', {
        description: 'Check your email if the account can be recovered.',
      });
      void navigate(`/${actor}/reset-password`, {
        state: { email: result.data.email },
      });
    } catch (error) {
      toast.error('Could not request a reset code', {
        description: userFacingApiError(error),
      });
    }
  }

  return (
    <>
      <div className="auth-heading">
        <h2>Reset password</h2>
        <p>Enter the email address for your Eventa account.</p>
      </div>

      <form
        className="login-form"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <TextField
          id={`${actor}-recovery-email`}
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={
            actor === 'admin' ? 'organizer@example.com' : 'you@example.com'
          }
          value={email}
          error={emailError}
          onChange={(event) => {
            setEmail(event.target.value);
            request.reset();
          }}
        />

        <Button
          type="submit"
          busy={request.isPending}
          className="login-form__submit"
        >
          {request.isPending ? 'Requesting code…' : 'Send reset code'}
        </Button>
      </form>

      <p className="auth-form-link">
        <Link to={`/${actor}/login`}>Back to sign in</Link>
      </p>
    </>
  );
}
