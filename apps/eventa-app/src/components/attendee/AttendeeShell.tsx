import {
  CompassIcon,
  DesktopIcon,
  GearSixIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SignOutIcon,
  SunIcon,
  TicketIcon,
  UserCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import { useLogout, useSession } from '../../lib/auth/useAuth';
import { useTheme } from '../../lib/theme/useTheme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Brand } from '../ui/Brand';

const navigation = [
  { to: '/attendee', label: 'Discover', icon: CompassIcon, end: true },
  { to: '/attendee/search', label: 'Find events', icon: MagnifyingGlassIcon, end: false },
  { to: '/attendee/tickets', label: 'My tickets', icon: TicketIcon, end: false },
] as const;

export function AttendeeShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const session = useSession('attendee');
  const logout = useLogout('attendee');
  const { theme, chooseTheme } = useTheme();

  useEffect(() => {
    if (!menuOpen) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [menuOpen]);

  async function signOut() {
    try {
      await logout.mutateAsync();
      void navigate('/attendee/login', { replace: true });
    } catch {
      // Keep the active session and display the request error.
    }
  }

  return (
    <div className="min-h-svh bg-[var(--workspace)] md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <a className="fixed -top-16 left-4 z-50 bg-[var(--paper)] px-4 py-3 focus:top-4" href="#attendee-main">Skip to content</a>
      <aside className={`fixed inset-y-0 left-0 z-30 flex h-svh w-[min(84vw,18rem)] flex-col border-r border-[var(--line)] bg-[var(--paper)] px-3 pt-6 transition-transform duration-200 motion-reduce:transition-none md:sticky md:top-0 md:w-auto md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-[105%]'}`} aria-label="Attendee navigation">
        <div className="flex items-center justify-between px-2.5">
          <Brand to="/attendee" />
          <button aria-label="Close navigation" className="grid size-9 place-items-center text-[var(--ink)] md:hidden" onClick={() => setMenuOpen(false)} type="button"><XIcon className="size-5" /></button>
        </div>
        <nav aria-label="Main navigation" className="mt-10 grid gap-1">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-semibold no-underline transition-colors hover:bg-[var(--soft)] hover:text-[var(--evergreen)] ${isActive ? 'bg-[var(--soft)] text-[var(--evergreen)]' : 'text-[var(--muted)]'}`} end={end} key={to} onClick={() => setMenuOpen(false)} to={to}>
              <Icon aria-hidden="true" className="size-5" weight="regular" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      {menuOpen ? <button aria-label="Close navigation" className="fixed inset-0 z-20 w-full bg-[#081d11]/45 md:hidden" onClick={() => setMenuOpen(false)} type="button" /> : null}
      <div className="min-w-0">
        <header className="flex min-h-16 items-center justify-between px-4 md:justify-end md:px-[clamp(1.2rem,4vw,3.3rem)]">
          <button aria-expanded={menuOpen} aria-label="Open navigation" className="grid size-9 place-items-center text-[var(--ink)] md:hidden" onClick={() => setMenuOpen(true)} type="button"><ListIcon className="size-5" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Open profile menu" className="grid size-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] transition-colors hover:bg-[var(--soft)]" type="button">
                <UserCircleIcon aria-hidden="true" className="size-6" weight="regular" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 border border-[var(--line)] bg-[var(--paper)] p-1.5 text-[var(--ink)] shadow-lg">
              <DropdownMenuLabel className="truncate px-2.5 py-2 text-xs text-[var(--muted)]">{session.data?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-10 gap-2 px-2.5" onSelect={() => { void navigate('/attendee/account'); }}>
                <GearSixIcon aria-hidden="true" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2.5 py-2 text-xs text-[var(--muted)]">Appearance</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme} onValueChange={(value) => { if (value === 'light' || value === 'dark' || value === 'system') chooseTheme(value); }}>
                <DropdownMenuRadioItem className="min-h-10 gap-2 px-2.5" value="light"><SunIcon aria-hidden="true" /> Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem className="min-h-10 gap-2 px-2.5" value="dark"><MoonIcon aria-hidden="true" /> Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem className="min-h-10 gap-2 px-2.5" value="system"><DesktopIcon aria-hidden="true" /> System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-10 gap-2 px-2.5" disabled={logout.isPending} onSelect={() => { void signOut(); }} variant="destructive">
                <SignOutIcon aria-hidden="true" /> {logout.isPending ? 'Signing out…' : 'Sign out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {logout.error ? <div className="mx-auto my-4 w-[calc(100%_-_2rem)] max-w-[1180px] rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">{userFacingApiError(logout.error)}</div> : null}
        <main id="attendee-main" className="min-h-[calc(100svh-4rem)]"><Outlet /></main>
      </div>
    </div>
  );
}
