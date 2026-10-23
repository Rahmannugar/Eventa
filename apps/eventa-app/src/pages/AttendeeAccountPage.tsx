import { DeleteAttendeeAccount } from '../components/account/DeleteAttendeeAccount';
import { AttendeeInterests } from '../components/attendee/AttendeeInterests';
import { useSession } from '../lib/auth/useAuth';

export function AttendeeAccountPage() {
  const session = useSession('attendee');
  const account = session.data;

  if (account?.actor !== 'attendee') return null;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-8 px-4 py-8 sm:px-8 sm:py-10 lg:px-10">
      <header>
        <h1 className="font-[var(--serif)] text-[clamp(2rem,4vw,2.8rem)] tracking-[-0.045em]">Account</h1>
      </header>

      <section className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--paper)] p-[clamp(1.25rem,3vw,2rem)]" aria-labelledby="account-details-title">
        <h2 className="mb-[1.35rem] text-lg" id="account-details-title">Your details</h2>
        <dl className="grid gap-4">
          <div className="grid gap-1 border-t border-[var(--line)] pt-4">
            <dt className="text-[13px] text-[var(--muted)]">Email address</dt>
            <dd className="font-semibold [overflow-wrap:anywhere]">{account.email}</dd>
          </div>
          <div className="grid gap-1 border-t border-[var(--line)] pt-4">
            <dt className="text-[13px] text-[var(--muted)]">Username</dt>
            <dd className="font-semibold [overflow-wrap:anywhere]">@{account.username}</dd>
          </div>
        </dl>
      </section>

      <AttendeeInterests />

      <div className="mt-8">
        <DeleteAttendeeAccount />
      </div>
    </div>
  );
}
