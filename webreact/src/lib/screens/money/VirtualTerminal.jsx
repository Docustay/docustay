// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.057 — VirtualTerminal.jsx — React port of webui/src/lib/screens/money/VirtualTerminal.svelte
// Props: { onNavigate }
// Archetype: EditorPage
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from "react";
import { request } from "@/lib/api.js";
import { loadStripe } from "@stripe/stripe-js";

import EditorPage from "@/lib/components/kit/archetypes/EditorPage.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

import { Field, FieldLabel, FieldContent, FieldDescription } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import FieldMoney from "@/lib/components/editor/FieldMoney.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";

export default function VirtualTerminal({ onNavigate = null }) {
  // ── Loading state ──────────────────────────────────────────────────────────────────────────
  const [screenPhase, setScreenPhase] = useState("loading"); // loading, ready, denied, error
  const [error, setError] = useState(null);

  // ── Form data ──────────────────────────────────────────────────────────────────────────────
  const [payerUserId, setPayerUserId] = useState("");
  const [payerLabel, setPayerLabel] = useState("");
  const [peopleOptions, setPeopleOptions] = useState([]);

  const [invoiceLabel, setInvoiceLabel] = useState("");

  const [amountMinor, setAmountMinor] = useState(null);
  const [postcode, setPostcode] = useState("");
  const [saveCardConsent, setSaveCardConsent] = useState(false);

  // ── Request key (generated once per form open) ─────────────────────────────────────────────
  const requestKeyRef = useRef(crypto.randomUUID());

  // ── Stripe state ───────────────────────────────────────────────────────────────────────────
  const [stripe, setStripe] = useState(null);
  const [elements, setElements] = useState(null);
  const [cardElement, setCardElement] = useState(null);
  const cardMountPointRef = useRef(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [publishableKey, setPublishableKey] = useState(null);
  const [paymentIntentId, setPaymentIntentId] = useState(null);

  // ── Submit state ───────────────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [chargesOff, setChargesOff] = useState(false);
  const [declineMessage, setDeclineMessage] = useState(null);
  const [isDeclined, setIsDeclined] = useState(false);
  const [initError, setInitError] = useState(null);

  // ── Track which payer/amount we've created an intent for ────────────────────────────────────
  const [lastPayerForIntent, setLastPayerForIntent] = useState("");
  const [lastAmountForIntent, setLastAmountForIntent] = useState(null);

  // ── Fetch people roster on mount ───────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    request("/api/list/people/all")
      .then((r) => {
        if (!live) return;
        setPeopleOptions(
          (r?.rows ?? []).map((p) => ({
            value: p.id,
            label: p.display_name ?? p.email ?? p.id,
          }))
        );
        setScreenPhase("ready");
      })
      .catch((err) => {
        if (!live) return;
        if (err.status === 403) {
          setScreenPhase("denied");
        } else {
          setError(err.message ?? "Failed to load people");
          setScreenPhase("error");
        }
      });
    return () => {
      live = false;
    };
  }, []);

  // ── Create payment intent when user enters payer and amount (so card element can mount) ─────
  useEffect(() => {
    // Only proceed if we have required fields
    if (!payerUserId || amountMinor === null || amountMinor === undefined || amountMinor <= 0) {
      if (paymentIntentId) {
        setPaymentIntentId(null);
        setClientSecret(null);
        setPublishableKey(null);
        setStripe(null);
        setElements(null);
        setCardElement(null);
      }
      setInitError(null);
      return;
    }

    // Skip if we already fetched an intent for these values
    if (
      paymentIntentId &&
      payerUserId === lastPayerForIntent &&
      amountMinor === lastAmountForIntent
    ) {
      return;
    }

    let canceled = false;
    (async () => {
      try {
        const result = await request("/api/money/terminal/intent", {
          method: "POST",
          body: {
            payerUserId,
            invoiceId: null,
            amountMinor,
            description: invoiceLabel || null,
            saveCard: saveCardConsent,
            saveCardConsent,
            requestKey: requestKeyRef.current,
          },
        });

        if (!canceled) {
          setClientSecret(result.clientSecret);
          setPublishableKey(result.publishableKey);
          setPaymentIntentId(result.paymentIntentId);
          setLastPayerForIntent(payerUserId);
          setLastAmountForIntent(amountMinor);
          setInitError(null);

          // Load Stripe
          const stripeInstance = await loadStripe(result.publishableKey);
          if (!stripeInstance) {
            throw new Error("Failed to load Stripe");
          }
          setStripe(stripeInstance);
          setElements(stripeInstance.elements());
        }
      } catch (err) {
        if (!canceled) {
          if (err.status === 503) {
            setChargesOff(true);
            setInitError("Card payments are switched off for now. Nothing was charged.");
          } else {
            setInitError(err.message ?? "Failed to initialize payment");
          }
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [payerUserId, amountMinor, invoiceLabel, saveCardConsent, paymentIntentId, lastPayerForIntent, lastAmountForIntent]);

  // ── Mount card element when Stripe is ready ────────────────────────────────────────────────
  useEffect(() => {
    if (!cardMountPointRef.current || !stripe || !elements || cardElement) return;
    const card = elements.create("card");
    setCardElement(card);
    card.mount(cardMountPointRef.current);
    return () => {
      card.unmount();
    };
  }, [stripe, elements, cardElement]);

  // ── Submit handler ─────────────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setDeclineMessage(null);
    setIsDeclined(false);

    try {
      // At this point, Stripe should already be initialized (from the effect)
      if (!cardElement || !stripe || !clientSecret) {
        throw new Error("Payment setup incomplete — please fill in payer and amount");
      }

      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            postal_code: postcode || undefined,
          },
        },
      });

      if (result.error) {
        // Card was declined or other error
        const errorMsg = result.error.message;
        if (result.error.type === "card_error") {
          setIsDeclined(true);
          setDeclineMessage(errorMsg);
          setSubmitError(errorMsg);
        } else {
          setSubmitError(errorMsg);
        }
      } else if (result.paymentIntent?.status === "succeeded") {
        // Success
        if (onNavigate) {
          onNavigate("/money/payments");
        }
      } else {
        // Unexpected state
        setSubmitError(
          `Payment status: ${result.paymentIntent?.status || "unknown"}`
        );
      }
    } catch (err) {
      if (err.status === 503) {
        setChargesOff(true);
        setSubmitError("Card payments are switched off for now. Nothing was charged.");
      } else {
        setSubmitError(err.message ?? "An error occurred");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const amountFormatted = (() => {
    if (amountMinor === null || amountMinor === undefined) return "$0.00";
    const dollars = Math.floor(amountMinor / 100);
    const cents = String(amountMinor % 100).padStart(2, "0");
    return `$${dollars}.${cents}`;
  })();

  const canSubmit =
    payerUserId &&
    amountMinor &&
    amountMinor > 0 &&
    !submitting &&
    !chargesOff &&
    !!cardElement;

  if (screenPhase === "loading") {
    return (
      <EditorPage
        header={{
          title: "Take a card over the phone",
          actions: [],
        }}
        loading={true}
        testId="virtual-terminal-page"
      />
    );
  }

  if (screenPhase === "denied") {
    return (
      <EditorPage
        header={{
          title: "Take a card over the phone",
          actions: [],
        }}
        testId="virtual-terminal-page"
      >
        <div className="rounded-lg border border-line bg-surface p-6">
          <p className="m-0 font-medium text-ink">
            You don't have permission to take payments.
          </p>
        </div>
      </EditorPage>
    );
  }

  if (screenPhase === "error") {
    return (
      <EditorPage
        header={{
          title: "Take a card over the phone",
          actions: [],
        }}
        testId="virtual-terminal-page"
      >
        <ErrorPanel error={error} variant="page" />
      </EditorPage>
    );
  }

  return (
    <EditorPage
      header={{
        title: "Take a card over the phone",
        actions: [],
      }}
      testId="virtual-terminal-page"
    >
      <div
        className="flex gap-5 items-start"
        data-testid="money-virtual-terminal"
      >
        <div className="flex-1 max-w-[540px]">
          {/* Header */}
          <div className="mb-6">
            <h1 className="m-0 text-2xl font-medium leading-tight text-ink">
              Take a card over the phone
            </h1>
            <p className="mt-2 text-sm text-mute">
              For someone who'd rather read you the number than click a link.
            </p>
          </div>

          {/* Form Container */}
          <div className="bg-white border border-line rounded-lg px-5 py-4.5">
            {/* Form */}
            <div className="space-y-4">
              {/* Who's paying */}
              <Field orientation="horizontal">
                <FieldLabel htmlFor="payer">Who's paying</FieldLabel>
                <FieldContent>
                  <Combobox
                    id="payer"
                    testId="payer-select"
                    value={payerUserId}
                    options={peopleOptions}
                    onValueChange={(v) => {
                      setPayerUserId(v);
                      const selected = peopleOptions.find((o) => o.value === v);
                      setPayerLabel(selected?.label ?? "");
                    }}
                  />
                </FieldContent>
              </Field>

              {/* What for */}
              <Field orientation="horizontal">
                <FieldLabel htmlFor="invoice">
                  What for
                  <span className="ml-1 text-xs text-mute">optional</span>
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="invoice"
                    testId="invoice-input"
                    type="text"
                    placeholder="Invoice or description"
                    value={invoiceLabel}
                    onChange={(e) => setInvoiceLabel(e.target.value)}
                  />
                  <FieldDescription>
                    Leave it empty and it's just a payment, not against anything.
                  </FieldDescription>
                </FieldContent>
              </Field>

              {/* Amount */}
              <FieldMoney
                testId="amount-field"
                label="Amount"
                valueMinor={amountMinor}
                onValueMinorChange={setAmountMinor}
                currency="USD"
                required
              />

              {/* Card number */}
              <Field orientation="horizontal">
                <FieldLabel htmlFor="card">Card number</FieldLabel>
                <FieldContent>
                  <div
                    id="card"
                    ref={cardMountPointRef}
                    className="min-h-10 border border-line rounded-lg px-3 flex items-center"
                  />
                </FieldContent>
              </Field>

              {/* Postcode */}
              <Field orientation="horizontal">
                <FieldLabel htmlFor="postcode">
                  Postcode
                  <span className="ml-1 text-xs text-mute">optional</span>
                </FieldLabel>
                <FieldContent>
                  <Input
                    id="postcode"
                    testId="postcode-input"
                    type="text"
                    placeholder="Postcode"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                  />
                  <FieldDescription>
                    Checked against the card. Fewer declines.
                  </FieldDescription>
                </FieldContent>
              </Field>

              {/* Keep card checkbox */}
              <div className="flex items-start gap-3 py-2 text-sm">
                <Checkbox
                  id="save-card"
                  testId="save-card-check"
                  checked={saveCardConsent}
                  onCheckedChange={setSaveCardConsent}
                  className="mt-1"
                />
                <label htmlFor="save-card" className="flex-1 cursor-pointer leading-relaxed">
                  <div>Keep the card for next time</div>
                  <div className="mt-1 text-xs text-mute">
                    Ask them first. It's their card.
                  </div>
                </label>
              </div>

              {/* Messages */}
              {initError && (
                <div className="rounded-lg px-3.5 py-3 text-sm bg-chip-bad-bg border border-bad-border text-chip-bad-ink" role="alert">
                  {initError}
                </div>
              )}

              {chargesOff && !initError && (
                <div className="rounded-lg px-3.5 py-3 text-sm bg-chip-warn-bg border border-warn-border text-chip-warn-ink" role="alert">
                  Card payments are switched off for now. Nothing was charged.
                </div>
              )}

              {isDeclined && (
                <div className="rounded-lg px-3.5 py-3 text-sm bg-chip-bad-bg border border-bad-border text-chip-bad-ink" role="alert">
                  <div className="font-medium">Card declined</div>
                  {declineMessage && (
                    <div className="mt-1">{declineMessage}</div>
                  )}
                </div>
              )}

              {submitError && !chargesOff && !isDeclined && (
                <div className="rounded-lg px-3.5 py-3 text-sm bg-chip-bad-bg border border-bad-border text-chip-bad-ink" role="alert">
                  {submitError}
                </div>
              )}

              {/* Submit button */}
              <Button
                testId="pay-button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full mt-4"
              >
                {submitting ? "Processing…" : `Take ${amountFormatted}`}
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-80 flex-shrink-0">
          {/* Worth knowing */}
          <div className="bg-white border border-line rounded-lg overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-hair font-medium text-sm text-ink">
              Worth knowing
            </div>
            <div className="divide-y divide-hair px-4 py-2">
              <div className="py-2.75">
                <div className="font-medium text-sm text-ink2">
                  3.4% + 30¢
                </div>
                <div className="mt-1 text-xs leading-normal text-mute">
                  Typing a card in costs more than any other way. A payment link costs 2.9%.
                </div>
              </div>

              <div className="py-2.75">
                <div className="font-medium text-sm text-ink2">
                  Never write the number down
                </div>
                <div className="mt-1 text-xs leading-normal text-mute">
                  Not on paper, not in a note. This screen keeps nothing.
                </div>
              </div>

              <div className="py-2.75">
                <div className="font-medium text-sm text-ink2">
                  More declines
                </div>
                <div className="mt-1 text-xs leading-normal text-mute">
                  Cards not present get refused more often. The postcode helps.
                </div>
              </div>
            </div>
          </div>

          {/* Easier ways */}
          <div className="bg-white border border-line rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-hair font-medium text-sm text-ink">
              Easier ways
            </div>
            <div className="divide-y divide-hair px-4 py-2">
              <div className="py-2.75 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-medium text-sm text-ink2">
                    Send a payment link
                  </div>
                  <div className="mt-1 text-xs leading-normal text-mute">
                    A text, and they pay on their own phone.
                  </div>
                </div>
                <Button
                  testId="send-link-btn"
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate?.("/money/payment-links")}
                  className="flex-shrink-0"
                >
                  Send one
                </Button>
              </div>

              <div className="py-2.75 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-medium text-sm text-ink2">
                    Tap to Pay
                  </div>
                  <div className="mt-1 text-xs leading-normal text-mute">
                    If they're in front of you.
                  </div>
                </div>
                <Button
                  testId="tap-to-pay-btn"
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate?.("/money/tap-to-pay")}
                  className="flex-shrink-0"
                >
                  Open
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </EditorPage>
  );
}
