import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { userFacingApiError } from '../lib/api/api-error';
import { useSession } from '../lib/auth/useAuth';
import { formatMoney, getCheckoutOrder, isFinalOrder } from '../lib/checkout/checkout.service';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function AttendeeCheckoutResultPage() {
  const { orderId } = useParams();
  const session = useSession('attendee');
  const attendeeId = session.data?.actor === 'attendee' ? session.data.attendeeId : undefined;
  const valid = orderId !== undefined && uuidPattern.test(orderId);
  const orderQuery = useQuery({
    queryKey: ['checkout', 'order', attendeeId, orderId],
    queryFn: ({ signal }) => getCheckoutOrder(orderId!, signal),
    enabled: valid && attendeeId !== undefined,
    retry: false,
    refetchInterval: (query) => query.state.data !== undefined && !isFinalOrder(query.state.data.status) ? 3000 : false,
  });
  const order = orderQuery.data;
  const returnToCheckout = order === undefined ? '/attendee/search' : `/attendee/events/${order.eventId}/checkout?ticketTypeId=${order.ticketTypeId}&quantity=${order.quantity}`;

  return <main className="min-h-screen bg-[var(--canvas)] px-4 py-7 text-[var(--ink)] sm:px-6 sm:py-12"><div className="mx-auto max-w-[680px]">
    <Link className="inline-flex min-h-11 items-center font-semibold text-[var(--evergreen)] no-underline hover:underline" to="/attendee/search">← Find events</Link>
    <section className="mt-7 grid justify-items-center gap-3 rounded-[22px] border border-border bg-[var(--paper)] p-6 text-center shadow-[0_10px_35px_rgb(23_35_29_/_4%)] sm:p-9 [&_p]:max-w-[48ch] [&_p]:leading-normal" aria-live="polite">
      {!valid && <><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Booking link is invalid</h1><Link to="/attendee/search">Find an event</Link></>}
      {valid && orderQuery.isPending && <><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Checking your booking</h1><p>Loading the latest status…</p></>}
      {valid && orderQuery.isError && <><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Could not check your booking</h1><p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3.5 leading-normal text-[var(--danger)] [&_button]:underline [&_a]:underline" role="alert">{userFacingApiError(orderQuery.error)}</p><button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white no-underline hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" type="button" onClick={() => void orderQuery.refetch()}>Try again</button></>}
      {order?.status === 'paid' && <><span className="grid size-[54px] place-items-center rounded-full bg-[var(--evergreen)] text-2xl text-white dark:text-[#0d1512]">✓</span><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Your booking is confirmed</h1><p>Your tickets will appear in My tickets when they are issued.</p><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white no-underline hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" to={`/attendee/tickets?orderId=${order.orderId}`}>My tickets</Link></>}
      {order !== undefined && ['pending_payment', 'pending_reservation'].includes(order.status) && <><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Payment is still pending</h1><p>We are checking your booking. You can return to payment if you have not finished it.</p>{order.reservationExpiresAt && <p>Complete payment before {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.reservationExpiresAt))}.</p>}<Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white no-underline hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" to={returnToCheckout}>Return to payment</Link></>}
      {order?.status === 'refunding' && <><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Your payment is being refunded</h1><p>The booking could not be completed. Check back for the refund status.</p></>}
      {order?.status === 'refunded' && <><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Your payment was refunded</h1><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white no-underline hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" to={`/attendee/events/${order.eventId}`}>See event</Link></>}
      {order !== undefined && ['failed', 'expired'].includes(order.status) && <><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Booking did not complete</h1><p>No tickets were issued for this booking.</p><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white no-underline hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" to={returnToCheckout}>Try again</Link></>}
      {order?.currency !== undefined && order.totalMinor !== undefined && <p className="w-full border-t border-border pt-5 text-[var(--muted)]">{formatMoney(order.totalMinor, order.currency)}</p>}
    </section>
  </div></main>;
}
