import { AuthShell } from '../components/auth/AuthShell';
import { ResetPasswordForm } from '../components/auth/ResetPasswordForm';
import { PublicSessionBoundary } from '../components/auth/SessionBoundary';
import type { Actor } from '../lib/auth/auth.types';

export function ResetPasswordPage({ actor }: { actor: Actor }) {
  return (
    <PublicSessionBoundary actor={actor}>
      <AuthShell
        actor={actor}
        headline="Set a new password."
        supporting="Use the code sent to your email."
      >
        <ResetPasswordForm actor={actor} />
      </AuthShell>
    </PublicSessionBoundary>
  );
}
