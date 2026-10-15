// ═══════════════════════════════════════════════════════════════════════════════════════════════
// StartSubscriptionSheet — "Start a subscription" (P3.U7 · W2). New component, no Svelte source:
// ported from specs/mockups/SubscriptionStart.frame.html (structure, order, labels, every text run)
// and the frame's generated wiring block (§3.3/§3.4). Opens as a person record's right-hand sheet.
//   · Plan — pick one of the catalogue's subscription plans. `api.view("/items/plans")` is the
//     catalogue's own list read (LIST_VIEWS['/items/plans'], src/records/lists/items.mjs) — the
//     same api.view(...) idiom BookSessionDialog.jsx already uses for a PICKER's options (its
//     `api.view("/items/services")`), not a list screen. Rows keep the read's own snake_case field
//     names (name, interval, price_amount_minor, price_currency) — no camelCase transform happens
//     on list rows anywhere in this codebase (routes/index.mjs's /api/list/* handler serialises
//     them as-is).
//   · Price — the CHOSEN plan's own current price, never typed.
//   · First charge — today, then the plan's own billing cadence.
//   · Card — pick one of the person's saved cards (personPaymentMethods, P3.S16/P3.A — resolves to
//     a plain array, not a wrapped object: src/routes/peopleRecord.mjs's `guarded` calls `c.json(r)`
//     on whatever the read returns, and personPaymentMethods returns `rows.map(...)` directly). If
//     none, the frame's own line says what happens instead: an emailed secure link.
//   · Credits — the plan's own sessions-per-month, read-only.
// Start renders write.error, including Stripe's own declined-card message (+ the reference id).
// ★ `person` — supplied by the host screen's record read, never invented here:
//   { id, displayName, contractId }. `contractId` is the executed contract naming this plan —
//   src/money/subscriptions.mjs:106 (`startClientSubscription`) refuses to start a subscription
//   without one, and the frame draws no field for it (nobody picks a contract on this sheet) — the
//   host screen resolves which contract that is and hands it in, exactly as SubscriptionActions'
//   `subscription` prop carries ids (`appUserId`, `stripeSubscriptionId`) its own frames never draw.
// ★ THE CARD PICKER'S CHOICE IS NOT SENT. `startSubscription` (api.js, P3.A) accepts exactly
//   `{planId, appUserId, contractId, priceMinorOverride, staffNote}` — no payment-method field
//   exists on that write today, and this task may not touch api.js to add one. Stripe charges the
//   customer's own default payment method (or, with none, emails the secure link the frame's own
//   "If there's no card" line describes) — so the picker here is the frame's own browsing control,
//   not a value this component can wire through a write the server does not accept it on.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import { api } from "@/lib/api.js";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";

const INTERVAL_WORD = { week: "week", month: "month", quarter: "quarter", year: "year" };

function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function planLabel(plan) {
  const word = INTERVAL_WORD[plan.interval] ?? plan.interval;
  return `${plan.name} — ${formatMoney(plan.price_amount_minor, plan.price_currency)} / ${word}`;
}

function cardLabel(card) {
  const brand = card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : "Card";
  return `${brand} ending ${card.lastFour}`;
}

function firstChargeLabel(plan) {
  if (!plan) return null;
  if (plan.interval === "month") {
    return `Today · then the ${ordinal(new Date().getDate())} of each month`;
  }
  const word = INTERVAL_WORD[plan.interval] ?? plan.interval;
  return `Today · then every ${word}`;
}

/** write.error is an ApiError — the server's own message, plus its request id (SubscriptionActions'
 *  own writeErrorNode idiom, the named house-style sibling). */
function writeErrorNode(error) {
  if (!error) return null;
  return (
    <>
      {error.message}
      {error.requestId && (
        <>
          <br />
          <span className="text-meta text-mute">Reference {error.requestId} — nothing changed.</span>
        </>
      )}
    </>
  );
}

export default function StartSubscriptionSheet({ person, open, onOpenChange, onStarted }) {
  const [planId, setPlanId] = useState(null);
  const [cardId, setCardId] = useState(null);
  const [plans, setPlans] = useState({ loading: false, error: null, data: [] });
  const [cards, setCards] = useState({ loading: false, error: null, data: [] });

  useEffect(() => { setPlanId(null); setCardId(null); }, [person?.id]);

  function refreshPlans() {
    setPlans((p) => ({ ...p, loading: true, error: null }));
    api.view("/items/plans")
      .then((r) => setPlans({ loading: false, error: null, data: r?.data?.rows ?? [] }))
      .catch((err) => setPlans({ loading: false, error: err, data: [] }));
  }
  function refreshCards() {
    if (!person?.id) return;
    setCards((c) => ({ ...c, loading: true, error: null }));
    api.personPaymentMethods(person.id)
      .then((data) => setCards({ loading: false, error: null, data: Array.isArray(data) ? data : (data?.items ?? data?.methods ?? []) }))
      .catch((err) => setCards({ loading: false, error: err, data: [] }));
  }
  useEffect(() => {
    if (open) { refreshPlans(); refreshCards(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, person?.id]);

  const plan = plans.data.find((p) => p.id === planId) ?? null;

  const blockedReason = !planId
    ? "Choose a plan to start."
    : !person?.contractId
      ? "No executed contract names this plan yet."
      : null;

  const start = useWrite("startSubscription", { ownerId: person?.id ?? null, blockedReason });

  if (!open) return null;

  async function handleStart() {
    const result = await start.run({ planId, appUserId: person?.id, contractId: person?.contractId });
    onStarted?.(result);
  }

  const planOptions = plans.data.map((p) => ({ value: p.id, label: planLabel(p) }));
  const cardOptions = cards.data.map((c) => ({ value: c.id, label: cardLabel(c) }));
  const sessionsIncluded = plan?.sessions_included ?? plan?.sessionsIncluded ?? 0;

  return (
    <SideSheet
      title="Start a subscription"
      testId="subscription-start-sheet"
      error={writeErrorNode(start.error)}
      onCancel={() => onOpenChange?.(false)}
      footer={(
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
          <WriteButton write={start} testId="subscription-start-submit" onClick={handleStart}>Start subscription</WriteButton>
        </footer>
      )}
    >
      <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Plan</div>
      <SheetRow label="Plan">
        {plans.loading ? (
          <Skeleton className="h-9 w-full" data-testid="subscription-start-plan-loading" />
        ) : plans.error ? (
          <ErrorPanel error={plans.error} subject="Plans" onRetry={refreshPlans} testId="subscription-start-plan-error" />
        ) : (
          <Combobox testId="subscription-start-plan" value={planId} options={planOptions} onValueChange={setPlanId}
                    emptyText="No plans in the catalogue yet." />
        )}
      </SheetRow>
      <SheetRow label="Price">
        {plan ? (
          <p className="m-0 text-field text-ink-2" data-testid="subscription-start-price">
            <Figure size="sm" testId="subscription-start-price-figure">{formatMoney(plan.price_amount_minor, plan.price_currency)}</Figure>
            {" "}— the plan’s price today
          </p>
        ) : (
          <p className="m-0 text-field text-mute" data-testid="subscription-start-price">Choose a plan first.</p>
        )}
      </SheetRow>
      <SheetRow label="First charge">
        <p className="m-0 text-field text-ink-2" data-testid="subscription-start-first-charge">
          {plan ? firstChargeLabel(plan) : "Choose a plan first."}
        </p>
      </SheetRow>

      <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Paid with</div>
      <SheetRow label="Card">
        {cards.loading ? (
          <Skeleton className="h-9 w-full" data-testid="subscription-start-card-loading" />
        ) : cards.error ? (
          <ErrorPanel error={cards.error} subject="Cards" onRetry={refreshCards} testId="subscription-start-card-error" />
        ) : (
          <Combobox testId="subscription-start-card" value={cardId} options={cardOptions} onValueChange={setCardId}
                    emptyText="No cards on file yet." />
        )}
      </SheetRow>
      <SheetRow label="If there’s no card">
        <p className="m-0 text-field text-ink-2" data-testid="subscription-start-no-card">We email them a secure link to add one</p>
      </SheetRow>

      <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Credits</div>
      <SheetRow label="Each month">
        <p className="m-0 text-field text-ink-2" data-testid="subscription-start-credits">
          {plan ? `${sessionsIncluded} session${sessionsIncluded === 1 ? "" : "s"} — from the plan` : "Choose a plan first."}
        </p>
      </SheetRow>
    </SideSheet>
  );
}
