// PaymentBox — the card form a signer uses for a `payment` field (QUEUE §23.5.11). Stripe's own Payment Element does the card entry (card details never touch our servers or this page's code);
// the server creates the PaymentIntent (`payment/start`), and after Stripe says the card went through the server RE-READS Stripe (`payment/confirm`) — this page's word that it is paid is never what counts.
// The signature button stays shut until the field reads paid; a declined card just shows Stripe's message and can be retried; closing this changes nothing (the same payment is re-opened next time).
import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/lib/components/ui/button.jsx";

function CardForm({ field, api, t, label, onPaid, onClose }) {
  const stripe = useStripe(), elements = useElements();
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  async function pay(e) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;                    // a double click is one payment
    setBusy(true); setError(null);
    const r = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (r.error) { setError(r.error.message || t("The payment did not go through.")); setBusy(false); return; }
    try {
      for (let i = 0; i < 6; i += 1) {                           // "processing" can take a moment: ask the server (which asks Stripe) a few times
        const c = await api("payment/confirm", { fieldId: field.id });
        if (c.paid) { onPaid(c.label ?? label); return; }
        if (c.status && !["processing", "requires_action"].includes(c.status)) break;
        await new Promise((ok) => setTimeout(ok, 1500));
      }
      setError(t("The payment did not go through.")); setBusy(false);
    } catch (err) { setError(err.message || t("The payment did not go through.")); setBusy(false); }
  }
  return (
    <form onSubmit={pay} className="space-y-3" data-testid="payment-form">
      <PaymentElement />
      {error && <p role="alert" className="m-0 text-meta text-bad" data-testid="payment-error">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!stripe || busy} data-testid="payment-pay">{busy ? t("Processing…") : t("Pay {{amount}}", { amount: label })}</Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t("Close")}</Button>
      </div>
    </form>
  );
}

export default function PaymentBox({ field, api, t, onPaid, onClose }) {
  const [state, setState] = useState({ phase: "loading" });      // loading | ready | error
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await api("payment/start", { fieldId: field.id });
        if (!live) return;
        if (s.paid) { onPaid(s.label); return; }
        const stripe = await loadStripe(s.publishableKey, s.stripeAccount ? { stripeAccount: s.stripeAccount } : undefined);
        if (!stripe) throw new Error(t("Payment could not load. Try again."));
        setState({ phase: "ready", stripe, clientSecret: s.clientSecret, label: s.label });
      } catch (e) { if (live) setState({ phase: "error", message: e.message || t("Payment could not load. Try again.") }); }
    })();
    return () => { live = false; };
  }, [field.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("Pay")} data-testid="payment-box">
      <div className="max-h-[92vh] w-full max-w-[480px] overflow-auto rounded-t-card bg-surface p-4 sm:rounded-card">
        <p className="m-0 mb-3 text-ui font-medium">{field.label || t("Payment")}{state.label ? ` — ${state.label}` : ""}</p>
        {state.phase === "loading" && <p className="m-0 text-body text-mute" data-testid="payment-loading">{t("Loading…")}</p>}
        {state.phase === "error" && <><p role="alert" className="m-0 text-body text-bad" data-testid="payment-load-error">{state.message}</p><Button className="mt-3" variant="ghost" onClick={onClose}>{t("Close")}</Button></>}
        {state.phase === "ready" && <Elements stripe={state.stripe} options={{ clientSecret: state.clientSecret }}><CardForm field={field} api={api} t={t} label={state.label} onPaid={onPaid} onClose={onClose} /></Elements>}
      </div>
    </div>
  );
}
