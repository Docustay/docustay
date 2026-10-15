// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WaysToPay — P3.U18 (W11). No Svelte source: behaviour comes from the WIRING-MAP §3.3/§3.4 rows for
// these testids (each frame's own "What every control on this frame does" block, quoted below) and
// PHASE-3.md's rules for P3.U18 (W11).
//
// Ported from specs/mockups/SetWalletDomains.frame.html (the "Ways to pay" page's own h1 and
// breadcrumb) and specs/mockups/SetMoney.frame.html (the Money settings hub's "Ways people can pay
// you" row this screen is opened from). The wallet-domains card and its Apple/Google Pay error band
// on SetWalletDomains.frame.html belong to WIRING-MAP row W13 (`walletDomains`) — a DIFFERENT task's
// calls, not this one's (field 4's Calls list names only `paymentMethodSettings`,
// `setPaymentMethodSettings`, `createFinancialConnectionsSession`) — so this component draws only the
// "Choose ways to pay" control and the "Verify bank account" control, never the wallet-domains card.
//
// ★★★ src/settings/paymentMethods.mjs's own rule (field 8(c)): the READ never throws — a Stripe
//     outage still returns the last SAVED choice, with `unavailable: true`, so this screen never goes
//     blank; the WRITE is a real attempt and its refusal renders as `write.error` (Save's own
//     ErrorPanel), never a re-worded one.
// ★ Only the ACTUAL WRITES (Save, Verify bank account) are gated on permission — same convention
//   AdjustCreditSheet.jsx/PersonMoneyBlock.jsx use — but here the checkboxes ARE the write surface
//   itself (there is no separate local-state step before them the way AdjustCreditSheet's amount
//   field is), so a denied viewer sees the whole "Choose ways to pay" control (`money-ways-to-pay`)
//   and the "Verify bank account" control (`money-verify-bank`) absent, with a read-only summary
//   Figure (positive control) staying in place — PHASE-3.md field 8's own wording ("the write testids
//   ABSENT with a figure testid PRESENT").
// ★ "Verify bank account" opens Stripe's own hosted Financial Connections flow. No existing React
//   helper for this was found in webreact/src (`collectFinancialConnectionsAccounts` — one grep,
//   DISPATCH.md); `@stripe/stripe-js` is already a webreact dependency (package.json), so the client
//   secret `createFinancialConnectionsSession` returns goes straight to it. Loading Stripe.js needs
//   the practice's publishable key, which only `api.stripePublishableKey()` (already built, P3.A)
//   supplies — necessary plumbing to actually open the flow field 4's Rules call for, not a new call
//   this task invents.
// ★ Verify bank account additionally renders DISABLED WITH ITS REASON when `stripeConnected` is false
//   (a missing PREREQUISITE, never hidden — the maintainer's rule) — the same "Connect Stripe first" convention
//   PersonMoneyBlock.jsx uses for its own Stripe-gated writes. `stripeConnected` is supplied by the
//   host screen's own record read (PHASE-3.md field 10's R-wave task); it defaults to true so this
//   component still renders its full working state before that wiring lands.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import { Checkbox } from "@/lib/components/ui/checkbox.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { api } from "@/lib/api.js";
import * as StripeJS from "@stripe/stripe-js";

const NO_STRIPE_REASON = "Connect Stripe first — Settings › Money.";

// ★ Common Stripe payment method configuration types, spelled out for people — everything else falls
//   back to a humanized version of Stripe's own key so a type this list doesn't yet know still shows
//   a readable label rather than nothing.
const METHOD_LABEL = {
  card: "Card",
  us_bank_account: "Bank transfer (ACH)",
  cashapp: "Cash App Pay",
  klarna: "Klarna",
  affirm: "Affirm",
  afterpay_clearpay: "Afterpay / Clearpay",
  link: "Link",
  amazon_pay: "Amazon Pay",
  paypal: "PayPal",
  alipay: "Alipay",
  wechat_pay: "WeChat Pay",
  sofort: "Sofort",
  ideal: "iDEAL",
  bacs_debit: "Bacs Direct Debit",
  sepa_debit: "SEPA Direct Debit",
  acss_debit: "Pre-authorized debit (Canada)",
  bancontact: "Bancontact",
  giropay: "giropay",
  eps: "EPS",
  p24: "Przelewy24",
  blik: "BLIK",
  boleto: "Boleto",
  oxxo: "OXXO",
  konbini: "Konbini",
  promptpay: "PromptPay",
  grabpay: "GrabPay",
  fpx: "FPX",
  revolut_pay: "Revolut Pay",
};

function labelFor(type) {
  return METHOD_LABEL[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sameChoice(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/** write.error is an ApiError — the server's own message, plus its request id (PersonMoneyBlock.jsx's own shape). */
function writeErrorPanel(error, subject, testId) {
  if (!error) return null;
  return <ErrorPanel error={error} subject={subject} testId={testId} />;
}

/**
 * @param stripeConnected — the host screen's own record read; missing/true renders the working state,
 *   `false` blocks "Verify bank account" with its reason (a missing prerequisite, DisabledWithReason).
 */
export default function WaysToPay({ stripeConnected = true } = {}) {
  const [state, setState] = useState({ loading: true, error: null, enabled: [], available: [], unavailable: false });
  const [selected, setSelected] = useState([]);
  const [verified, setVerified] = useState(false);

  const saveWrite = useWrite("setPaymentMethodSettings");
  const verifyWrite = useWrite("createFinancialConnectionsSession", {
    blockedReason: stripeConnected ? null : NO_STRIPE_REASON,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await api.paymentMethodSettings();
      const enabled = result?.enabled ?? [];
      const available = result?.available ?? [];
      setState({ loading: false, error: null, enabled, available, unavailable: !!result?.unavailable });
      setSelected(enabled);
    } catch (error) {
      setState({ loading: false, error, enabled: [], available: [], unavailable: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(type) {
    setSelected((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  async function handleSave() {
    try {
      const result = await saveWrite.run({ enabled: selected });
      setState((s) => ({ ...s, enabled: result?.enabled ?? selected }));
    } catch {
      // saveWrite.error renders inline below (ErrorPanel) — the checkboxes stay as the user left them.
    }
  }

  async function handleVerifyBank() {
    setVerified(false);
    try {
      const { clientSecret } = await verifyWrite.run({ personId: null });
      const { publishableKey } = await api.stripePublishableKey();
      const stripe = await StripeJS.loadStripe(publishableKey);
      const { error } = await stripe.collectFinancialConnectionsAccounts({ clientSecret });
      if (error) throw error;
      setVerified(true);
    } catch {
      // verifyWrite.error (or Stripe's own collect error) renders inline below — the surface stays open.
    }
  }

  const dirty = !sameChoice(selected, state.enabled);
  const summaryText = state.enabled.length > 0 ? state.enabled.map(labelFor).join(", ") : "No ways to pay chosen yet.";

  return (
    <div className="flex flex-col gap-4" data-testid="ways-to-pay-screen">
      <div className="text-meta text-mute" data-testid="ways-to-pay-crumb">Settings › Money</div>
      <PageTitle testId="ways-to-pay-title">Ways to pay</PageTitle>

      {state.loading ? (
        <div aria-busy="true" data-testid="ways-to-pay-loading"><AppSpinner label="Loading…" /></div>
      ) : state.error ? (
        <ErrorPanel error={state.error} subject="Ways to pay" testId="ways-to-pay-error" onRetry={load} />
      ) : (
        <>
          {state.unavailable && (
            <p className="text-ui text-mute" data-testid="ways-to-pay-unavailable">
              Couldn't confirm with Stripe — showing the last saved choice.
            </p>
          )}

          <Figure size="md" testId="money-ways-to-pay-summary">{summaryText}</Figure>

          {!saveWrite.hidden && (
            state.available.length === 0 ? (
              <p className="text-ui text-mute" data-testid="ways-to-pay-empty">
                Nothing to choose from yet — save once Stripe has a default set up for this practice.
              </p>
            ) : (
              <fieldset className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4.5" data-testid="money-ways-to-pay">
                <legend className="text-heading font-semibold text-ink">Choose ways to pay</legend>
                {state.available.map((type) => (
                  <div key={type} className="flex items-center gap-2 text-ui text-ink" data-testid={`money-ways-to-pay-${type}`}>
                    <Checkbox id={`money-ways-to-pay-${type}-checkbox`} data-testid={`money-ways-to-pay-${type}-checkbox`}
                              checked={selected.includes(type)} onCheckedChange={() => toggle(type)} />
                    <label htmlFor={`money-ways-to-pay-${type}-checkbox`}>{labelFor(type)}</label>
                  </div>
                ))}
                {writeErrorPanel(saveWrite.error, "Saving ways to pay", "money-ways-to-pay-error")}
                <div className="mt-2 flex justify-end">
                  <WriteButton write={saveWrite} testId="money-ways-to-pay-save" busyLabel="Saving…"
                               disabled={!dirty} onClick={handleSave}>
                    Save
                  </WriteButton>
                </div>
              </fieldset>
            )
          )}

          <div className="flex items-center gap-3" data-testid="verify-bank-row">
            <WriteButton write={verifyWrite} testId="money-verify-bank" busyLabel="Verifying…" onClick={handleVerifyBank}>
              Verify bank account
            </WriteButton>
            {verified && <StatusBadge tone="ok" label="Verified" testId="money-verify-bank-status" />}
          </div>
          {writeErrorPanel(verifyWrite.error, "Verifying the bank account", "money-verify-bank-error")}
        </>
      )}
    </div>
  );
}
