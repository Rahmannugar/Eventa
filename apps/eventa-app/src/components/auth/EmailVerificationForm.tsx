import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import {
  confirmAttendeeEmailSchema,
  emailSchema,
} from '../../lib/auth/auth.validation';
import {
  useConfirmAttendeeEmail,
  useResendAttendeeEmail,
} from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { OtpField } from '../ui/OtpField';
import { TextField } from '../ui/TextField';

interface FormErrors {
  email?: string;
  otp?: string;
}

function initialEmail(state: unknown): string {
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

export function EmailVerificationForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const confirmation = useConfirmAttendeeEmail();
  const resend = useResendAttendeeEmail();
  const [email, setEmail] = useState(() => initialEmail(location.state));
  const [otp, setOtp] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = confirmAttendeeEmailSchema.safeParse({ email, otp });

    if (!result.success) {
      const nextErrors: FormErrors = {};

      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (
          (field === 'email' || field === 'otp') &&
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
      await confirmation.mutateAsync(result.data);
      void navigate('/attendee/login', {
        replace: true,
        state: {
          email: result.data.email,
          emailVerified: true,
        },
      });
    } catch {
      // The normalized request error remains visible in the form.
    }
  }

  async function requestAnotherCode() {
    const result = emailSchema.safeParse(email);

    if (!result.success) {
      setErrors((current) => ({
        ...current,
        email:
          result.error.issues[0]?.message ?? 'Enter a valid email address.',
      }));
      return;
    }

    setErrors((current) => {
      const remainingErrors = { ...current };
      delete remainingErrors.email;
      return remainingErrors;
    });

    try {
      await resend.mutateAsync({ email: result.data });
    } catch {
      // The normalized request error remains visible beside the action.
    }
  }

  return (
    <>
      <div className="auth-heading">
        <h2>Verify email</h2>
        <p>Enter the six-digit code sent to your email address.</p>
      </div>

      <form
        className="login-form"
        noValidate
        onSubmit={(event) => {
          void confirm(event);
        }}
      >
        <TextField
          id="attendee-verification-email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          error={errors.email}
          onChange={(event) => {
            setEmail(event.target.value);
            resend.reset();
          }}
        />

        <OtpField
          id="attendee-verification-code"
          label="Verification code"
          disabled={confirmation.isPending || resend.isPending}
          value={otp}
          error={errors.otp}
          onChange={setOtp}
        />

        {confirmation.error === null ? null : (
          <div className="form-alert" role="alert" aria-live="assertive">
            {userFacingApiError(confirmation.error)}
          </div>
        )}

        {resend.error === null ? null : (
          <div className="form-alert" role="alert" aria-live="assertive">
            {userFacingApiError(resend.error)}
          </div>
        )}

        {resend.isSuccess ? (
          <div className="form-status" role="status">
            A new verification code was requested. Check your email.
          </div>
        ) : null}

        <Button
          type="submit"
          busy={confirmation.isPending}
          disabled={resend.isPending}
          className="login-form__submit"
        >
          {confirmation.isPending ? 'Verifying…' : 'Verify email'}
        </Button>

        <Button
          type="button"
          variant="secondary"
          busy={resend.isPending}
          disabled={confirmation.isPending}
          onClick={() => {
            void requestAnotherCode();
          }}
        >
          {resend.isPending ? 'Requesting code…' : 'Send another code'}
        </Button>
      </form>

      <p className="auth-form-link">
        <Link to="/attendee/login">Back to sign in</Link>
      </p>
    </>
  );
}
