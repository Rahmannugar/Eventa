import type { Actor } from '../lib/auth/auth.types';
import { AccountShell } from '../components/layout/AccountShell';

export function AccountPage({ actor }: { actor: Actor }) {
  return <AccountShell actor={actor} />;
}
