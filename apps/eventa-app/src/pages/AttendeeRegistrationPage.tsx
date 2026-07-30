import { AuthShell } from '../components/auth/AuthShell';
import { RegistrationForm } from '../components/auth/RegistrationForm';
import { PublicSessionBoundary } from '../components/auth/SessionBoundary';

export function AttendeeRegistrationPage() {
  return (
    <PublicSessionBoundary actor="attendee">
      <AuthShell
        actor="attendee"
        headline="Join Eventa."
        supporting="Create your attendee account."
      >
        <RegistrationForm />
      </AuthShell>
    </PublicSessionBoundary>
  );
}
