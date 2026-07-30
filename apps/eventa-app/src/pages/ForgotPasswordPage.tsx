import { ForgotPasswordForm } from '../components/auth/ForgotPasswordForm';
import { AuthShell } from '../components/auth/AuthShell';
import { PublicSessionBoundary } from '../components/auth/SessionBoundary';
import type { Actor } from '../lib/auth/auth.types';

export function ForgotPasswordPage({ actor }: { actor: Actor }) {
  return (
    <PublicSessionBoundary actor={actor}>
      <AuthShell
        actor={actor}
        headline="Recover your account."
        supporting="Request a password reset code."
      >
        <ForgotPasswordForm actor={actor} />
      </AuthShell>
    </PublicSessionBoundary>
  );
}
