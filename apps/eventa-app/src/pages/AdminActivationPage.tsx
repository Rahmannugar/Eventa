import { AdminActivationForm } from '../components/auth/AdminActivationForm';
import { AuthShell } from '../components/auth/AuthShell';
import { PublicSessionBoundary } from '../components/auth/SessionBoundary';

export function AdminActivationPage() {
  return (
    <PublicSessionBoundary actor="admin">
      <AuthShell
        actor="admin"
        headline="Activate your account."
        supporting="Set up access to the Admin Dashboard."
      >
        <AdminActivationForm />
      </AuthShell>
    </PublicSessionBoundary>
  );
}
