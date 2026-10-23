import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { CheckoutPaymentForm } from '../components/checkout/CheckoutPaymentForm';
import { userFacingApiError } from '../lib/api/api-error';
import { useSession } from '../lib/auth/useAuth';
import { clearCheckoutAttempt, readCheckoutAttempt, writeCheckoutAttempt, type CheckoutAttempt } from '../lib/checkout/checkout-attempt';
import { formatMoney, getCheckoutEvent, getCheckoutOrder, getCheckoutTicketOptions, isFinalOrder, startCheckout } from '../lib/checkout/checkout.service';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rawStripeKey: unknown = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripeKey = typeof rawStripeKey === 'string' && /^pk_(test|live)_/.test(rawStripeKey) ? rawStripeKey : undefined;
const stripePromise = stripeKey === undefined ? undefined : loadStripe(stripeKey);

export function AttendeeCheckoutPage() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const session = useSession('attendee');
  const attendeeId = session.data?.actor === 'attendee' ? session.data.attendeeId : undefined;
  const ticketTypeId = searchParams.get('ticketTypeId');
  const quantity = Number(searchParams.get('quantity') ?? '1');
  if (attendeeId === undefined) return <main className="min-h-screen bg-[var(--canvas)] px-4 py-7 text-[var(--ink)] sm:px-6 sm:py-12"><p>Loading checkout…</p></main>;
  return <CheckoutContent key={`${attendeeId}:${eventId ?? ''}:${ticketTypeId ?? ''}:${quantity}`} attendeeId={attendeeId} eventId={eventId} ticketTypeId={ticketTypeId} quantity={quantity} />;
}

function CheckoutContent({ attendeeId, eventId, ticketTypeId, quantity }: { attendeeId: string; eventId: string | undefined; ticketTypeId: string | null; quantity: number }) {
  const valid = eventId !== undefined && uuidPattern.test(eventId) && ticketTypeId !== null && uuidPattern.test(ticketTypeId) && Number.isInteger(quantity) && quantity >= 1 && quantity <= 1_000_000;
  const selection = valid ? { attendeeId, eventId, ticketTypeId, quantity } : undefined;
  const [attempt, setAttempt] = useState<CheckoutAttempt | undefined>(() => selection === undefined ? undefined : readCheckoutAttempt(selection));
  const [payment, setPayment] = useState<{ paymentId: string; clientSecret: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const eventQuery = useQuery({
    queryKey: ['checkout', 'event', eventId],
    queryFn: ({ signal }) => getCheckoutEvent(eventId!, signal),
    enabled: valid,
    retry: false,
  });
  const optionsQuery = useQuery({
    queryKey: ['checkout', 'options', attendeeId, eventId],
    queryFn: ({ signal }) => getCheckoutTicketOptions(eventId!, signal),
    enabled: valid,
    retry: false,
  });
  const orderQuery = useQuery({
    queryKey: ['checkout', 'order', attendeeId, attempt?.orderId],
    queryFn: ({ signal }) => getCheckoutOrder(attempt!.orderId!, signal),
    enabled: attempt?.orderId !== undefined,
    retry: false,
    refetchInterval: (query) => query.state.data !== undefined && !isFinalOrder(query.state.data.status) ? 3000 : false,
  });
  const startMutation = useMutation({
    mutationFn: startCheckout,
    onSuccess: (result) => {
      const current = readCheckoutAttempt({ attendeeId, eventId: result.eventId, ticketTypeId: result.ticketTypeId, quantity: result.quantity }) ?? attempt;
      if (current !== undefined) {
        const saved = { ...current, orderId: result.orderId };
        writeCheckoutAttempt(saved);
        setAttempt(saved);
      }
      setPayment(result.payment);
      queryClient.setQueryData(['checkout', 'order', attendeeId, result.orderId], result);
    },
  });

  const ticket = useMemo(() => optionsQuery.data?.currencies.flatMap((group) => group.ticketTypes.map((type) => ({ ...type, currency: group.currency }))).find((type) => type.ticketTypeId === ticketTypeId), [optionsQuery.data, ticketTypeId]);
  const order = orderQuery.data ?? startMutation.data;
  const terminal = order !== undefined && isFinalOrder(order.status);
  const canBuy = ticket !== undefined && ['available', 'eligible', 'reserved'].includes(ticket.availability.status) && ticket.availability.salesOpen && ticket.availability.quantity >= quantity;
  const canContinue = attempt !== undefined || canBuy;

  function beginPayment() {
    if (selection === undefined || stripePromise === undefined || startMutation.isPending) return;
    const existing = readCheckoutAttempt(selection) ?? attempt;
    const current = existing ?? { ...selection, key: crypto.randomUUID() };
    writeCheckoutAttempt(current);
    setAttempt(current);
    startMutation.mutate({ eventId: selection.eventId, ticketTypeId: selection.ticketTypeId, quantity: selection.quantity, idempotencyKey: current.key });
  }

  function restart() {
    if (attempt !== undefined) {
      clearCheckoutAttempt(attempt);
      if (attempt.orderId !== undefined) queryClient.removeQueries({ queryKey: ['checkout', 'order', attendeeId, attempt.orderId] });
    }
    setAttempt(undefined);
    setPayment(undefined);
    startMutation.reset();
  }

  if (!valid) {
    return <main className="min-h-screen bg-[var(--canvas)] px-4 py-7 text-[var(--ink)] sm:px-6 sm:py-12"><section className="min-w-0 rounded-[22px] border border-border bg-[var(--paper)] p-6 shadow-[0_10px_35px_rgb(23_35_29_/_4%)] sm:p-9"><h1 className="font-[var(--serif)] text-3xl">Checkout link is invalid</h1><Link to="/attendee/search">Find an event</Link></section></main>;
  }

  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-7 text-[var(--ink)] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-[1050px]">
        <Link className="inline-flex min-h-11 items-center font-semibold text-[var(--evergreen)] no-underline hover:underline" to={`/attendee/events/${eventId}`}>← Event details</Link>
        <header className="my-6 sm:my-8"><h1 className="font-[var(--serif)] text-[clamp(2.2rem,4vw,3.6rem)] leading-[1.08]">Complete your booking</h1></header>
        <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <section className="min-w-0 rounded-[22px] border border-border bg-[var(--paper)] p-6 shadow-[0_10px_35px_rgb(23_35_29_/_4%)] sm:p-9" aria-labelledby="checkout-summary-title">
            <h2 className="mb-6 font-[var(--serif)] text-[1.75rem]" id="checkout-summary-title">Your tickets</h2>
            {eventQuery.isPending || optionsQuery.isPending ? <p>Loading ticket details…</p> : null}
            {eventQuery.isError || optionsQuery.isError ? <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3.5 leading-normal text-[var(--danger)] [&_button]:underline [&_a]:underline" role="alert">Could not load ticket details. <button type="button" onClick={() => { void eventQuery.refetch(); void optionsQuery.refetch(); }}>Try again</button></p> : null}
            {eventQuery.data && ticket && <>
              <h3 className="mb-2.5 font-[var(--serif)] text-[1.35rem]">{eventQuery.data.title}</h3>
              <p className="my-2 text-[var(--muted)]">{new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: eventQuery.data.timeZone }).format(new Date(eventQuery.data.startsAt))}</p>
              <p className="my-2 text-[var(--muted)]">{eventQuery.data.venue.name}, {eventQuery.data.venue.city}</p>
              <div className="mt-7 flex items-start justify-between gap-5 border-t border-border py-6 [&_strong]:whitespace-nowrap"><span>{ticket.name} × {quantity}</span><strong>{formatMoney(ticket.priceMinor * quantity, ticket.currency)}</strong></div>
              {order?.totalMinor !== undefined && order.currency !== undefined && <div className="flex items-start justify-between gap-5 border-t border-border pt-6 text-lg [&_strong]:whitespace-nowrap"><span>Total</span><strong>{formatMoney(order.totalMinor, order.currency)}</strong></div>}
            </>}
            {optionsQuery.isSuccess && ticket === undefined && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3.5 leading-normal text-[var(--danger)] [&_button]:underline [&_a]:underline" role="alert">This ticket is no longer available. <Link to={`/attendee/events/${eventId}`}>See ticket options</Link>.</p>}
          </section>
          <section className="min-w-0 rounded-[22px] border border-border bg-[var(--paper)] p-6 shadow-[0_10px_35px_rgb(23_35_29_/_4%)] sm:p-9" aria-labelledby="checkout-payment-title">
            <h2 className="mb-6 font-[var(--serif)] text-[1.75rem]" id="checkout-payment-title">Payment</h2>
            {stripePromise === undefined && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3.5 leading-normal text-[var(--danger)] [&_button]:underline [&_a]:underline" role="alert">Payments are unavailable right now. Please try again later.</p>}
            {orderQuery.isError && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3.5 leading-normal text-[var(--danger)] [&_button]:underline [&_a]:underline" role="alert">Could not check your booking. <button type="button" onClick={() => void orderQuery.refetch()}>Try again</button></p>}
            {order?.status === 'paid' && <div className="grid justify-items-start gap-4"><p>Your booking is confirmed.</p><Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white no-underline hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" to={`/attendee/tickets?orderId=${order.orderId}`}>View your tickets</Link><button className="inline-block min-h-11 py-3 font-semibold text-[var(--evergreen)] underline" type="button" onClick={restart}>Buy more tickets</button></div>}
            {order?.status === 'refunding' && <p className="rounded-xl bg-[var(--soft)] px-4 py-3.5 leading-normal">Your booking could not be completed. Your payment is being refunded.</p>}
            {order?.status === 'refunded' && <p className="rounded-xl bg-[var(--soft)] px-4 py-3.5 leading-normal">Your payment has been refunded.</p>}
            {(order?.status === 'failed' || order?.status === 'expired') && <div className="grid justify-items-start gap-4"><p>This booking could not be completed.</p><button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white no-underline hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" type="button" onClick={restart}>Try a new booking</button></div>}
            {!terminal && order?.status !== 'refunding' && payment !== undefined && stripePromise !== undefined && <>
              {order?.reservationExpiresAt && <p className="my-2 text-[var(--muted)]">Complete payment before {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.reservationExpiresAt))}.</p>}
              <Elements key={payment.paymentId} stripe={stripePromise} options={{ clientSecret: payment.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#0b5945', borderRadius: '12px' } } }}>
                <CheckoutPaymentForm orderId={order!.orderId} onSubmitted={() => { void navigate(`/attendee/checkout/${order!.orderId}`); }} />
              </Elements>
            </>}
            {!terminal && order?.status !== 'refunding' && payment === undefined && <>
              {order?.status === 'pending_payment' && <p className="my-2 text-[var(--muted)]">Your tickets are held while you finish payment.</p>}
              {order?.reservationExpiresAt && <p className="my-2 text-[var(--muted)]">Complete payment before {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.reservationExpiresAt))}.</p>}
              {startMutation.isError && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3.5 leading-normal text-[var(--danger)] [&_button]:underline [&_a]:underline" role="alert">{userFacingApiError(startMutation.error)}</p>}
              <button className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" type="button" disabled={stripePromise === undefined || !canContinue || startMutation.isPending || (attempt?.orderId !== undefined && orderQuery.isPending)} onClick={beginPayment}>
                {startMutation.isPending ? 'Preparing payment…' : orderQuery.isPending && attempt?.orderId !== undefined ? 'Checking booking…' : order?.status === 'pending_payment' ? 'Continue payment' : 'Continue to payment'}
              </button>
            </>}
            {order?.orderId && !terminal && <Link className="inline-block min-h-11 py-3 font-semibold text-[var(--evergreen)] underline" to={`/attendee/checkout/${order.orderId}`}>Check booking status</Link>}
          </section>
        </div>
      </div>
    </main>
  );
}
