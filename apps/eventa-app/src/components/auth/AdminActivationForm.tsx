import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { userFacingApiError } from '../../lib/api/api-error';
import {
  activateAdminSchema,
  requestAdminActivationSchema,
} from '../../lib/auth/auth.validation';
import {
  useActivateAdmin,
  useRequestAdminActivation,
} from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { OtpField } from '../ui/OtpField';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';

interface FormErrors {
  email?: string;
  otp?: string;
  password?: string;
}

export function AdminActivationForm() {
  const navigate = useNavigate();
  const activationRequest = useRequestAdminActivation();
  const activation = useActivateAdmin();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [showActivation, setShowActivation] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  async function requestCode() {
    const result = requestAdminActivationSchema.safeParse({ email });

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
      await activationRequest.mutateAsync(result.data);
      setShowActivation(true);
      toast.success('Activation code requested', {
        description: 'Check your email if the account is eligible.',
      });
    } catch {
      // The normalized request error remains visible in the form.
    }
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = activateAdminSchema.safeParse({ email, otp, password });

    if (!result.success) {
      const nextErrors: FormErrors = {};

      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (
          (field === 'email' || field === 'otp' || field === 'password') &&
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
      await activation.mutateAsync(result.data);
      void navigate('/admin/login', {
        replace: true,
        state: {
          adminActivated: true,
          email: result.data.email,
        },
      });
    } catch {
      // The normalized request error remains visible in the form.
    }
  }

  if (!showActivation) {
    return (
      <>
        <div className="mt-10 mb-8 [&_h2]:my-3 [&_h2]:font-[Georgia] [&_h2]:text-[clamp(2.25rem,8vw,3.15rem)] [&_h2]:font-medium [&_h2]:leading-none [&_h2]:tracking-[-.05em] [&_p:last-child]:text-[.92rem] [&_p:last-child]:leading-relaxed [&_p:last-child]:text-[var(--muted)]">
          <h2>Activate account</h2>
          <p>Use the email approved for your organizer account.</p>
        </div>

        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode();
          }}
        >
          <TextField
            id="admin-activation-request-email"
            label="Email address"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="organizer@example.com"
            value={email}
            error={errors.email}
            onChange={(event) => {
              setEmail(event.target.value);
              activationRequest.reset();
            }}
          />

          {activationRequest.error === null ? null : (
            <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-3 text-[.8rem] font-semibold leading-normal text-[var(--danger)]" role="alert" aria-live="assertive">
              {userFacingApiError(activationRequest.error)}
            </div>
          )}

          <Button
            type="submit"
            busy={activationRequest.isPending}
            className="mt-1 w-full"
          >
            {activationRequest.isPending
              ? 'Requesting code…'
              : 'Send activation code'}
          </Button>

          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setShowActivation(true);
            }}
          >
            I already have a code
          </Button>
        </form>

        <p className="mt-6 text-[.8rem] leading-relaxed text-[var(--muted)] [&_a]:font-bold [&_a]:text-[var(--evergreen)] [&_a]:underline-offset-4">
          <Link to="/admin/login">Back to sign in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <div className="mt-10 mb-8 [&_h2]:my-3 [&_h2]:font-[Georgia] [&_h2]:text-[clamp(2.25rem,8vw,3.15rem)] [&_h2]:font-medium [&_h2]:leading-none [&_h2]:tracking-[-.05em] [&_p:last-child]:text-[.92rem] [&_p:last-child]:leading-relaxed [&_p:last-child]:text-[var(--muted)]">
        <h2>Complete activation</h2>
        <p>Enter your activation code and choose your password.</p>
      </div>

      <form
        className="grid gap-5"
        noValidate
        onSubmit={(event) => {
          void activate(event);
        }}
      >
        <TextField
          id="admin-activation-email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="organizer@example.com"
          value={email}
          error={errors.email}
          onChange={(event) => {
            setEmail(event.target.value);
            activationRequest.reset();
          }}
        />

        <OtpField
          id="admin-activation-code"
          label="Activation code"
          disabled={activation.isPending || activationRequest.isPending}
          value={otp}
          error={errors.otp}
          onChange={setOtp}
        />

        <PasswordField
          id="admin-activation-password"
          label="Password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />

        {activation.error === null ? null : (
          <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-3 text-[.8rem] font-semibold leading-normal text-[var(--danger)]" role="alert" aria-live="assertive">
            {userFacingApiError(activation.error)}
          </div>
        )}

        {activationRequest.error === null ? null : (
          <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3.5 py-3 text-[.8rem] font-semibold leading-normal text-[var(--danger)]" role="alert" aria-live="assertive">
            {userFacingApiError(activationRequest.error)}
          </div>
        )}

        <Button
          type="submit"
          busy={activation.isPending}
          disabled={activationRequest.isPending}
          className="mt-1 w-full"
        >
          {activation.isPending ? 'Activating…' : 'Activate account'}
        </Button>

        <Button
          type="button"
          variant="secondary"
          busy={activationRequest.isPending}
          disabled={activation.isPending}
          onClick={() => {
            void requestCode();
          }}
        >
          {activationRequest.isPending
            ? 'Requesting code…'
            : 'Send another code'}
        </Button>
      </form>

      <p className="mt-6 text-[.8rem] leading-relaxed text-[var(--muted)] [&_a]:font-bold [&_a]:text-[var(--evergreen)] [&_a]:underline-offset-4">
        <Link to="/admin/login">Back to sign in</Link>
      </p>
    </>
  );
}
