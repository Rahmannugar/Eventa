import { Link } from 'react-router-dom';

import { EventSearch } from '../components/search/EventSearch';
import { Brand } from '../components/ui/Brand';

export function AttendeeSearchPage() {
  return (
    <main className="account-shell account-shell--attendee">
      <header className="account-shell__header">
        <Brand />
        <div className="account-shell__header-end">
          <Link className="account-shell__nav" to="/attendee">
            Account
          </Link>
          <span className="actor-badge">Attendee</span>
        </div>
      </header>

      <section className="account-shell__content">
        <div>
          <h1>Find events</h1>
        </div>
        <EventSearch />
      </section>
    </main>
  );
}
