import type { Actor } from '../lib/auth/auth.types';
import { AuthShell } from '../components/auth/AuthShell';
import { LoginForm } from '../components/auth/LoginForm';
import { PublicSessionBoundary } from '../components/auth/SessionBoundary';

export function LoginPage({ actor }: { actor: Actor }) {
  return (
    <PublicSessionBoundary actor={actor}>
      <AuthShell actor={actor}>
        <LoginForm actor={actor} />
      </AuthShell>
    </PublicSessionBoundary>
  );
}
