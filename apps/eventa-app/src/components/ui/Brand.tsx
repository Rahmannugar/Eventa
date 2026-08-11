import { TicketIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';

interface BrandProps {
  inverse?: boolean;
  to?: string;
}

export function Brand({ inverse = false, to = '/attendee/login' }: BrandProps) {
  return (
    <Link
      className={`brand ${inverse ? 'brand--inverse' : ''}`.trim()}
      to={to}
      aria-label="Eventa home"
    >
      <span className="brand__mark" aria-hidden="true">
        <TicketIcon weight="fill" />
      </span>
      <span>eventa</span>
    </Link>
  );
}
