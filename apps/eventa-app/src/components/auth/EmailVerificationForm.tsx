import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

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
      toast.success('Verification code requested', {
        description: 'Check your email for the new code.',
      });
    } catch {
      // The normalized request error remains visible beside the action.
    }
  }

  return (
    <>
      <div className="mt-10 mb-8 [&_h2]:my-3 [&_h2]:font-[Georgia] [&_h2]:text-[clamp(2.25rem,8vw,3.15rem)] [&_h2]:font-medium [&_h2]:leading-none [&_h2]:tracking-[-.05em] [&_p:last-child]:text-[.92rem] [&_p:last-child]:leading-relaxed [&_p:last-child]:text-[var(--muted)]">
        <h2>Verify email</h2>
        <p>Enter the six-digit code sent to your email address.</p>
      </div>

      <form
        className="grid gap-5"
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
          <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-3 text-[.8rem] font-semibold leading-normal text-[var(--danger)]" role="alert" aria-live="assertive">
            {userFacingApiError(confirmation.error)}
          </div>
        )}

        {resend.error === null ? null : (
          <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-3 text-[.8rem] font-semibold leading-normal text-[var(--danger)]" role="alert" aria-live="assertive">
            {userFacingApiError(resend.error)}
          </div>
        )}

        <Button
          type="submit"
          busy={confirmation.isPending}
          disabled={resend.isPending}
          className="mt-1 w-full"
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

      <p className="mt-6 text-[.8rem] leading-relaxed text-[var(--muted)] [&_a]:font-bold [&_a]:text-[var(--evergreen)] [&_a]:underline-offset-4">
        <Link to="/attendee/login">Back to sign in</Link>
      </p>
    </>
  );
}
