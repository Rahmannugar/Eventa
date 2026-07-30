import { AuthShell } from '../components/auth/AuthShell';
import { EmailVerificationForm } from '../components/auth/EmailVerificationForm';
import { PublicSessionBoundary } from '../components/auth/SessionBoundary';

export function AttendeeEmailVerificationPage() {
  return (
    <PublicSessionBoundary actor="attendee">
      <AuthShell
        actor="attendee"
        headline="Verify your email."
        supporting="Enter the code we sent you."
      >
        <EmailVerificationForm />
      </AuthShell>
    </PublicSessionBoundary>
  );
}
