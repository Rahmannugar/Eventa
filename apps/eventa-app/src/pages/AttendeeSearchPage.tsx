import { EventSearch } from '../components/search/EventSearch';

export function AttendeeSearchPage() {
  return (
    <div className="mx-auto w-[calc(100%_-_2rem)] max-w-[1180px] pb-20 pt-5 sm:w-[calc(100%_-_3rem)] sm:pt-10">
      <header className="mb-8">
        <h1 className="font-[family-name:var(--serif)] text-4xl tracking-tight">Find events</h1>
      </header>
      <EventSearch />
    </div>
  );
}
