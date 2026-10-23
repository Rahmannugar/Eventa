import { TicketIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';

interface BrandProps {
  inverse?: boolean;
  to?: string;
}

export function Brand({ inverse = false, to = '/attendee/login' }: BrandProps) {
  return (
    <Link
      className={`inline-flex w-fit items-center gap-2.5 text-[1.08rem] font-extrabold tracking-[-.04em] no-underline ${inverse ? 'text-[#fffdf8]' : 'text-[var(--ink)]'}`}
      to={to}
      aria-label="Eventa home"
    >
      <span className="grid size-9 -rotate-4 place-items-center rounded-xl bg-[var(--persimmon)] text-white" aria-hidden="true">
        <TicketIcon className="size-5" weight="fill" />
      </span>
      <span>eventa</span>
    </Link>
  );
}
