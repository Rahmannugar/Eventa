import { ArrowRightIcon, MapPinIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';

import { RecommendedEvents } from '../components/attendee/RecommendedEvents';
import { EventSearch } from '../components/search/EventSearch';

export function AttendeeHomePage() {
  return (
    <div className="mx-auto w-[calc(100%_-_2rem)] max-w-[1180px] pb-20 pt-5 sm:w-[calc(100%_-_3rem)] sm:pt-10">
      <section className="relative flex min-h-60 items-center overflow-hidden rounded-3xl bg-[linear-gradient(115deg,#093b31,#0d5b46_62%,#167356)] p-6 text-white sm:p-[clamp(2rem,5vw,3.4rem)]">
        <div className="relative z-10 max-w-xl">
          <h1 className="my-3 font-[family-name:var(--serif)] text-[clamp(2.3rem,4.7vw,4rem)] leading-[1.05] tracking-[-.04em]">Find your next event.</h1>
          <p className="max-w-lg text-sm leading-relaxed text-[#d7ede1] sm:text-base">Explore what is happening, find something nearby, and choose the event you want to attend.</p>
          <Link className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-bold text-[#0a4a39] no-underline hover:bg-[#e9f5eb]" to="/attendee/search">Browse events <ArrowRightIcon aria-hidden="true" /></Link>
        </div>
        <div aria-hidden="true" className="absolute right-[-2rem] grid size-56 place-items-center text-[#b7e6d1] opacity-25 lg:right-[7%] lg:opacity-70"><span className="absolute size-52 rounded-full border border-[#a8dec7] shadow-[0_0_0_2.6rem_rgb(168_222_199_/_11%)]" /><MapPinIcon className="size-24 -rotate-12" weight="duotone" /></div>
      </section>

      <RecommendedEvents />

      <section aria-labelledby="explore-heading" className="mt-10">
        <div className="mb-5 flex flex-col items-start justify-between gap-3 min-[460px]:flex-row min-[460px]:items-end"><h2 className="font-[family-name:var(--serif)] text-[clamp(1.6rem,3vw,2rem)] tracking-tight" id="explore-heading">Upcoming events</h2><Link className="inline-flex items-center gap-1 text-sm font-bold text-[var(--evergreen-deep)] no-underline hover:underline" to="/attendee/search">See all events <ArrowRightIcon aria-hidden="true" /></Link></div>
        <EventSearch />
      </section>
    </div>
  );
}
