import { CalendarDotsIcon, ChartLineUpIcon, ListIcon, PlusIcon, SignOutIcon, TicketIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { userFacingApiError } from '../../lib/api/api-error';
import { useLogout, useSession } from '../../lib/auth/useAuth';
import { Brand } from '../ui/Brand';

export function AdminDashboardShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession('admin');
  const logout = useLogout('admin');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const account = session.data;

  useEffect(() => {
    if (!menuOpen) return;
    closeButton.current?.focus();
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
      if (event.key === 'Tab') {
        const focusable = drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [menuOpen]);

  if (account?.actor !== 'admin') return null;
  const email = account.email;

  async function signOut() {
    try {
      await logout.mutateAsync();
      void navigate('/admin/login', { replace: true });
    } catch {
      // The live session remains available and the error is shown in the shell.
    }
  }

  const heading = location.pathname === '/admin/analytics' ? 'Analytics' :
    location.pathname === '/admin/events/new' ? 'Create event' :
      location.pathname.endsWith('/edit') ? 'Edit event' :
        location.pathname.startsWith('/admin/events/') ? 'Event details' : 'Events';

  function navigation() {
    return (
      <>
        <div className="grid justify-items-start gap-1 px-3 pt-1 pb-6 text-[11px] font-bold tracking-widest uppercase text-white/65"><Brand inverse to="/admin" /><span>Organizer</span></div>
        <Link className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--persimmon)] text-sm font-bold text-white no-underline transition-colors hover:bg-[#d85c3b]" to="/admin/events/new" onClick={() => setMenuOpen(false)}>
          <PlusIcon aria-hidden="true" size={18} /> Create event
        </Link>
        <nav className="mt-7 grid flex-1 content-start gap-1" aria-label="Organizer navigation">
          <span className="px-3 pb-2 text-[11px] font-bold tracking-widest text-white/55 uppercase">Workspace</span>
          <NavLink end to="/admin" onClick={() => setMenuOpen(false)} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold no-underline transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-offset-[-4px] ${isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_var(--persimmon)]' : 'text-white/75'}`}>
            <CalendarDotsIcon aria-hidden="true" size={19} /> Events
          </NavLink>
          <NavLink to="/admin/analytics" onClick={() => setMenuOpen(false)} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold no-underline transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-offset-[-4px] ${isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_var(--persimmon)]' : 'text-white/75'}`}>
            <ChartLineUpIcon aria-hidden="true" size={19} /> Analytics
          </NavLink>
        </nav>
        <div className="grid grid-cols-[35px_minmax(0,1fr)_40px] items-center gap-2 border-t border-white/15 p-2.5">
          <span className="grid size-[35px] place-items-center rounded-lg bg-[rgb(239_113_79_/_20%)] text-[#ffc1a8]" aria-hidden="true"><TicketIcon size={19} weight="fill" /></span>
          <span className="grid min-w-0 gap-0.5"><strong className="text-xs">Organizer</strong><small className="truncate text-[11px] text-white/60" title={email}>{email}</small></span>
          <button className="grid min-h-10 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white" aria-label="Sign out" disabled={logout.isPending} onClick={() => void signOut()} title="Sign out" type="button"><SignOutIcon aria-hidden="true" size={19} /></button>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--workspace)] text-[var(--ink)]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] min-w-0 flex-col border-r border-white/10 bg-[#0a3f33] px-[15px] pt-[23px] pb-4 text-[#fffdf8] min-[900px]:flex dark:bg-[#12382c]">{navigation()}</aside>
      {menuOpen && (
        <div className="fixed inset-0 z-50 min-[900px]:hidden">
          <button className="absolute inset-0 w-full bg-[#041610]/55" aria-label="Close navigation" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} type="button" />
          <aside ref={drawer} aria-label="Organizer navigation" aria-modal="true" className="absolute inset-y-0 left-0 flex w-[min(290px,86vw)] min-w-0 flex-col bg-[#0a3f33] px-[15px] pt-[22px] pb-4 text-[#fffdf8] shadow-[10px_0_30px_rgb(0_0_0_/_20%)] dark:bg-[#12382c] [&>div:first-of-type]:pr-[50px]" role="dialog">
            <button ref={closeButton} className="absolute top-[15px] right-[15px] grid size-11 place-items-center rounded-lg bg-white/10 text-white" aria-label="Close navigation" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} type="button"><XIcon size={20} /></button>
            {navigation()}
          </aside>
        </div>
      )}
      <div className="min-h-screen min-w-0 min-[900px]:pl-[248px]">
        <header className="sticky top-0 z-10 flex h-[58px] items-center gap-3 bg-[var(--workspace)] px-3 backdrop-blur-sm min-[561px]:h-16 min-[561px]:px-[clamp(20px,3vw,48px)]">
          <button ref={menuButton} className="grid size-11 place-items-center rounded-lg text-[var(--evergreen)] hover:bg-[var(--soft)] min-[900px]:hidden" aria-expanded={menuOpen} aria-label="Open navigation" onClick={() => setMenuOpen(true)} type="button"><ListIcon size={21} /></button>
          <div className="min-[900px]:hidden"><Brand to="/admin" /></div>
          <span className="hidden text-[13px] font-bold min-[900px]:block">{heading}</span>
          <span className="flex-1" />
          {heading !== 'Events' && heading !== 'Create event' && <Link className="flex size-10 items-center justify-center gap-2 rounded-lg border border-[var(--line)] text-xs font-bold text-[var(--evergreen)] no-underline hover:bg-[var(--soft)] min-[561px]:h-[38px] min-[561px]:w-auto min-[561px]:px-3" to="/admin/events/new"><PlusIcon aria-hidden="true" size={17} /><span className="max-[560px]:sr-only">Create event</span></Link>}
        </header>
        {logout.error && <div className="border-b border-red-700/20 bg-[var(--danger-soft)] px-[clamp(1rem,4vw,2.5rem)] py-3 text-[13px] font-semibold text-[#812a24]" role="alert">{userFacingApiError(logout.error)}</div>}
        <Outlet />
      </div>
    </div>
  );
}
