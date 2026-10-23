import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useState, type FormEvent } from 'react';

interface CheckoutPaymentFormProps {
  orderId: string;
  onSubmitted: () => void;
}

export function CheckoutPaymentForm({ orderId, onSubmitted }: CheckoutPaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stripe === null || elements === null || !paymentReady || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/attendee/checkout/${encodeURIComponent(orderId)}`,
        },
        redirect: 'if_required',
      });
      if (result.error !== undefined) {
        setError(result.error.message ?? 'Payment could not be completed. Check your details and try again.');
        setSubmitting(false);
        return;
      }
      onSubmitted();
    } catch {
      setError('Payment could not be completed. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-5" onSubmit={(event) => void submit(event)}>
      <PaymentElement onReady={() => setPaymentReady(true)} options={{ layout: 'tabs' }} />
      {error && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-3.5 leading-normal text-[var(--danger)] [&_button]:underline [&_a]:underline" role="alert">{error}</p>}
      <button className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--evergreen)] px-4 py-2 font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#0d1512]" type="submit" disabled={stripe === null || elements === null || !paymentReady || submitting}>
        {submitting ? 'Processing payment…' : !paymentReady || stripe === null || elements === null ? 'Loading payment…' : 'Pay now'}
      </button>
    </form>
  );
}
