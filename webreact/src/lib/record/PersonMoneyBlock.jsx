// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PersonMoneyBlock — P3.U8 (W3). The person record's Money tab content: four cards — Credit balance,
// Discount, Tax IDs, Saved cards — plus the "Apply a coupon" header action. No Svelte source:
// behaviour comes from the WIRING-MAP §3.3/§3.4 rows for these testids (each frame's own "What every
// control on this frame does" block, quoted below) and PHASE-3.md's rules for P3.U8 (W3).
//
// Ported from specs/mockups/PersonMoney.frame.html (the populated card grid) and
// PersonMoneyStates.frame.html (loading · no permission · disabled with reason · error · empty ·
// blocked). The h1 ("Maya Okafor") and the Overview/Sessions/Documents/Money tabs are the HOST
// SCREEN's own render (its R-wave task, PHASE-3.md field 10) — this component is only the Money
// tab's own content, starting with its header action row.
//
// ★★★ NO Stripe customer → Adjust credit balance AND Add tax ID render DISABLED WITH THE REASON
//     (PersonMoneyStates' "Disabled with its reason" and "Blocked" cells, quoted verbatim below) —
//     a missing PREREQUISITE renders disabled with the reason, never hidden (the maintainer's rule). Every other
//     write here (remove coupon, apply a coupon, remove tax id, remove card) is gated on PERMISSION
//     ONLY (useWrite's `hidden`) — nothing in the frame's states board disables them for "no Stripe",
//     and without a Stripe customer there is nothing on these cards to remove regardless.
// ★ Reads (personCreditLedger, personPaymentMethods, personTaxIds) are three independent fetches, each
//   with its own loading/error — "each read renders its own ErrorPanel" (PHASE-3.md field 4). The
//   credit balance figure is the SUM of the ledger's own `amountMinor` entries (the mirror computes
//   nothing server-side — GROUP-C-RECLUSTERED.md's "Stripe is the money record" ruling, moneyReads.mjs).
// ★ `person` — supplied by the host screen's record read, never invented here:
//   { id, name, stripeCustomerId: string|null, discount: { id, label } | null,
//     availableCoupons?: [{ value, label }] }.
//   `discount.label` is the fully formatted line ("RETURNING10 — 10% off, 3 months left") — same
//   shape SubscriptionActions.jsx assumes for `subscription.discount`. `availableCoupons` feeds the
//   "Apply a coupon" combobox — no coupon-list method is named in this task's Calls, so the host
//   screen supplies the options it already has for its own coupon surfaces; an empty list still
//   renders a working (if optionless) control, never a broken one.
// ★ Adjust credit balance (AdjustCreditSheet, P3.U9) and Add tax ID (TaxIdSheet, P3.U10) are OPENED
//   here through `fileComponent` inside `<Suspense>` (DISPATCH.md) — this component never calls
//   `adjustCredit` or `addTaxId` itself, and never assumes those files exist yet.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Suspense, useCallback, useEffect, useState } from "react";
import Figure from "@/lib/components/kit/Figure.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { api } from "@/lib/api.js";
import { fileComponent } from "@/lib/app/lazyScreens.js";

const AdjustCreditSheet = fileComponent("lib/money/AdjustCreditSheet.jsx");
const TaxIdSheet = fileComponent("lib/money/TaxIdSheet.jsx");

const CREDIT_STRIPE_REASON = "Connect Stripe first — a credit balance lives on their Stripe customer.";
const TAX_ID_STRIPE_REASON = "Add a tax ID once Stripe is connected.";

const TAX_ID_TONE = { verified: "ok", pending: "warn", failed: "bad" };
const TAX_ID_LABEL = { verified: "Verified", pending: "Pending", failed: "Failed" };

function centsLabel(amountMinor) {
  return ((amountMinor ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** write.error is an ApiError — the server's own message, plus its request id (matches SubscriptionActions.jsx). */
function writeErrorNode(error) {
  if (!error) return null;
  return (
    <>
      {error.message}
      {error.requestId && (
        <>
          {" "}
          <span className="text-meta text-mute">Reference {error.requestId} — nothing changed.</span>
        </>
      )}
    </>
  );
}

export default function PersonMoneyBlock({ person }) {
  const personId = person?.id ?? null;
  const noStripe = !person?.stripeCustomerId;

  // ★ Hooks run unconditionally (Rules of Hooks) — every useWrite below runs before any early return.
  const removeCoupon = useWrite("removeCouponFromPerson", { ownerId: personId });
  const applyCoupon = useWrite("applyCouponToPerson", { ownerId: personId });
  const removeTaxIdWrite = useWrite("removeTaxId", { ownerId: personId });
  const removeCard = useWrite("detachPaymentMethod", { ownerId: personId });
  const adjustGate = useWrite("adjustCredit", { ownerId: personId, blockedReason: noStripe ? CREDIT_STRIPE_REASON : null });
  const addTaxIdGate = useWrite("addTaxId", { ownerId: personId, blockedReason: noStripe ? TAX_ID_STRIPE_REASON : null });

  const [ledger, setLedger] = useState({ loading: true, error: null, entries: [] });
  const [cards, setCards] = useState({ loading: true, error: null, methods: [] });
  const [taxIds, setTaxIds] = useState({ loading: true, error: null, taxIds: [] });

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [taxIdOpen, setTaxIdOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [couponChoice, setCouponChoice] = useState(null);

  const loadLedger = useCallback(async () => {
    if (!personId) return;
    setLedger((s) => ({ ...s, loading: true, error: null }));
    try {
      const entries = await api.personCreditLedger(personId);
      setLedger({ loading: false, error: null, entries: entries ?? [] });
    } catch (error) {
      setLedger({ loading: false, error, entries: [] });
    }
  }, [personId]);

  const loadCards = useCallback(async () => {
    if (!personId) return;
    setCards((s) => ({ ...s, loading: true, error: null }));
    try {
      const methods = await api.personPaymentMethods(personId);
      setCards({ loading: false, error: null, methods: methods ?? [] });
    } catch (error) {
      setCards({ loading: false, error, methods: [] });
    }
  }, [personId]);

  const loadTaxIds = useCallback(async () => {
    if (!personId) return;
    setTaxIds((s) => ({ ...s, loading: true, error: null }));
    try {
      const list = await api.personTaxIds(personId);
      setTaxIds({ loading: false, error: null, taxIds: list ?? [] });
    } catch (error) {
      setTaxIds({ loading: false, error, taxIds: [] });
    }
  }, [personId]);

  useEffect(() => { loadLedger(); }, [loadLedger]);
  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadTaxIds(); }, [loadTaxIds]);

  async function runRemoveCoupon() {
    if (!person?.discount) return;
    try {
      await removeCoupon.run({ couponId: person.discount.id, userId: personId });
    } catch {
      // removeCoupon.error renders inline below — the card stays as is.
    }
  }

  async function submitApplyCoupon(e) {
    e?.preventDefault?.();
    if (!couponChoice) return;
    try {
      await applyCoupon.run({ couponId: couponChoice, userId: personId });
      setApplyOpen(false);
      setCouponChoice(null);
    } catch {
      // applyCoupon.error renders inline below — the surface stays open.
    }
  }

  async function runRemoveTaxId(taxIdId) {
    try {
      await removeTaxIdWrite.run({ taxIdId });
      await loadTaxIds();
    } catch {
      // removeTaxIdWrite.error renders inline below — the list stays as is.
    }
  }

  async function runRemoveCard(paymentMethodId) {
    try {
      await removeCard.run({ paymentMethodId });
      await loadCards();
    } catch {
      // removeCard.error renders inline below — the list stays as is.
    }
  }

  const couponOptions = person?.availableCoupons ?? [];
  const balanceMinor = ledger.entries.reduce((sum, entry) => sum + (entry?.amountMinor ?? 0), 0);

  return (
    <div className="flex flex-col gap-4" data-testid="person-money">
      <div className="flex items-center justify-end">
        <WriteButton write={applyCoupon} variant="outline" testId="person-money-apply-coupon" onClick={() => setApplyOpen(true)}>
          Apply a coupon
        </WriteButton>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Credit balance */}
        <div className="rounded-card border border-line bg-surface p-4.5" data-testid="person-money-ledger">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-heading font-semibold text-ink">Credit balance</h2>
            <WriteButton write={adjustGate} variant="outline" size="sm" testId="person-money-adjust-credit" onClick={() => setAdjustOpen(true)}>
              Adjust
            </WriteButton>
          </div>
          {ledger.loading ? (
            <div className="mt-2 flex flex-col gap-2" aria-busy="true" data-testid="person-money-ledger-loading">
              <span className="block h-6 w-1/2 rounded-sm bg-mute-bg" />
              <span className="block h-3 w-4/5 rounded-sm bg-mute-bg" />
            </div>
          ) : ledger.error ? (
            <ErrorPanel error={ledger.error} subject="The credit ledger" testId="person-money-ledger-error" />
          ) : (
            <>
              <Figure size="lg" className="mt-2 block" testId="person-money-balance-figure">{centsLabel(balanceMinor)}</Figure>
              <p className="mt-1 text-ui text-mute">Used first on their next invoice.</p>
            </>
          )}
        </div>

        {/* Discount */}
        <div className="rounded-card border border-line bg-surface p-4.5" data-testid="person-money-discount">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-heading font-semibold text-ink">Discount</h2>
            {person?.discount && (
              <WriteButton write={removeCoupon} variant="outline" size="sm" testId="person-money-remove-coupon" onClick={runRemoveCoupon}>
                Remove
              </WriteButton>
            )}
          </div>
          <p className="mt-2 text-ui text-ink" data-testid="person-money-discount-label">
            {person?.discount ? person.discount.label : "No discount applied."}
          </p>
          {removeCoupon.error && <ErrorPanel error={removeCoupon.error} subject="Removing the coupon" testId="person-money-remove-coupon-error" />}
        </div>

        {/* Tax IDs */}
        <div className="rounded-card border border-line bg-surface p-4.5" data-testid="person-money-tax-ids">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-heading font-semibold text-ink">Tax IDs</h2>
            <WriteButton write={addTaxIdGate} variant="outline" size="sm" testId="person-money-add-tax-id" onClick={() => setTaxIdOpen(true)}>
              Add
            </WriteButton>
          </div>
          {taxIds.loading ? (
            <div className="mt-2 flex flex-col gap-2" aria-busy="true" data-testid="person-money-tax-ids-loading">
              <span className="block h-4 w-2/3 rounded-sm bg-mute-bg" />
            </div>
          ) : taxIds.error ? (
            <ErrorPanel error={taxIds.error} subject="Tax IDs" testId="person-money-tax-ids-error" />
          ) : taxIds.taxIds.length === 0 ? (
            <p className="mt-2 text-ui text-mute" data-testid="person-money-tax-ids-empty">
              {noStripe ? TAX_ID_STRIPE_REASON : "No tax IDs on file."}
            </p>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {taxIds.taxIds.map((taxId) => (
                <li key={taxId.id} className="flex items-center gap-2 text-ui text-ink" data-testid={`person-money-tax-id-${taxId.id}`}>
                  <span>{taxId.type} {taxId.value}</span>
                  <StatusBadge tone={TAX_ID_TONE[taxId.verificationState] ?? "neutral"}
                                label={TAX_ID_LABEL[taxId.verificationState] ?? taxId.verificationState}
                                testId={`person-money-tax-id-${taxId.id}-status`} />
                  <WriteButton write={removeTaxIdWrite} variant="ghost" size="sm" testId="person-money-remove-tax-id" onClick={() => runRemoveTaxId(taxId.id)}>
                    Remove
                  </WriteButton>
                </li>
              ))}
            </ul>
          )}
          {removeTaxIdWrite.error && <ErrorPanel error={removeTaxIdWrite.error} subject="Removing the tax ID" testId="person-money-remove-tax-id-error" />}
        </div>

        {/* Saved cards */}
        <div className="rounded-card border border-line bg-surface p-4.5" data-testid="person-money-cards">
          <h2 className="m-0 text-heading font-semibold text-ink">Saved cards</h2>
          {cards.loading ? (
            <div className="mt-2 flex flex-col gap-2" aria-busy="true" data-testid="person-money-cards-loading">
              <span className="block h-4 w-3/4 rounded-sm bg-mute-bg" />
            </div>
          ) : cards.error ? (
            <ErrorPanel error={cards.error} subject="Saved cards" testId="person-money-cards-error" />
          ) : cards.methods.length === 0 ? (
            <div data-testid="person-money-cards-empty">
              <p className="m-0 mt-2 text-heading font-medium text-ink">No saved cards</p>
              <p className="mt-1 text-ui text-mute">
                Cards are saved when {person?.name?.split(" ")[0] ?? "this person"} pays online and says yes to saving.
              </p>
            </div>
          ) : (
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {cards.methods.map((method) => (
                <li key={method.id} className="flex items-center gap-2 text-ui text-ink" data-testid={`person-money-card-${method.id}`}>
                  <span>{method.brand} ending {method.lastFour}{method.isDefault ? " · default" : ""}</span>
                  <WriteButton write={removeCard} variant="ghost" size="sm" testId="person-money-remove-card" onClick={() => runRemoveCard(method.id)}>
                    Remove
                  </WriteButton>
                </li>
              ))}
            </ul>
          )}
          {removeCard.error && <ErrorPanel error={removeCard.error} subject="Removing the card" testId="person-money-remove-card-error" />}
        </div>
      </div>

      {applyOpen && (
        <ActionSurface kind="dialog" title="Apply a coupon" testId="person-money-apply-coupon-panel"
                        busy={applyCoupon.busy} error={writeErrorNode(applyCoupon.error)} submitLabel="Apply"
                        submitDisabled={!couponChoice} onCancel={() => setApplyOpen(false)} onSubmit={submitApplyCoupon}>
          <SheetRow label="Coupon" htmlFor="person-money-apply-coupon-combobox" required>
            <Combobox id="person-money-apply-coupon-combobox" testId="person-money-apply-coupon-combobox"
                      options={couponOptions} value={couponChoice} onValueChange={setCouponChoice} placeholder="Search coupons…" />
          </SheetRow>
        </ActionSurface>
      )}

      {/* Each opens with its OWN useWrite (same route this block already checked to draw its own
          button) and returns null while its own `open` is false — mounted once, shown via `open`,
          exactly as InvoiceActionsMenu.jsx mounts MarkPaidDialog/AttachPaymentSheet/CreditNoteSheet. */}
      <Suspense fallback={<AppSpinner label="Loading…" />}>
        <AdjustCreditSheet person={person} open={adjustOpen} onOpenChange={setAdjustOpen}
                           onAdjusted={() => { setAdjustOpen(false); loadLedger(); }} />
      </Suspense>
      <Suspense fallback={<AppSpinner label="Loading…" />}>
        <TaxIdSheet person={person} open={taxIdOpen} onOpenChange={setTaxIdOpen}
                    onAdded={() => { setTaxIdOpen(false); loadTaxIds(); }} />
      </Suspense>
    </div>
  );
}
