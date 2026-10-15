// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PAYMENT METHODS — Rebuild from PaymentMethods.frame.html and StripePaymentMethods.frame.html
// Ported from webui/src/lib/screens/money/PaymentMethods.svelte; same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request, ApiError } from "@/lib/api.js";
import PaymentMethodRow from "@/lib/money/PaymentMethodRow.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import FieldMoney from "@/lib/components/editor/FieldMoney.jsx";

export default function PaymentMethods({ onNavigate = null }) {
  // ── State for loading and errors ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");

  // ── Data fetched from API ──────────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);

  // ── Form state for ACH nudge and BNPL minimum ──────────────────────────────────────────────
  const [achNudgeMinimum, setAchNudgeMinimum] = useState(50000); // Default: $500
  const [bnplMinimum, setBnplMinimum] = useState(20000);         // Default: $200
  const [savingAch, setSavingAch] = useState(false);
  const [savingBnpl, setSavingBnpl] = useState(false);
  const [capabilities, setCapabilities] = useState({});

  // ── UI state ────────────────────────────────────────────────────────────────────────────────
  const [showFeesDetail, setShowFeesDetail] = useState(false);

  // ── Computed ACH example ────────────────────────────────────────────────────────────────────
  const [achExampleFee, setAchExampleFee] = useState(null);

  const STRIPE_US_RATES = {
    online: { pct: 2.9, fixed: 30 },
    typed: { pct: 3.4, fixed: 30 },
    in_person: { pct: 2.7, fixed: 5 },
    bank: { pct: 0.8, capMinor: 500 },
  };

  function stripeFeesMinor(amountMinor, method = "online") {
    const rate = STRIPE_US_RATES[method];
    if (!rate) return 0;

    let feeMinor = Math.ceil((amountMinor * rate.pct) / 100) + (rate.fixed ?? 0);
    if (rate.capMinor && feeMinor > rate.capMinor) {
      feeMinor = rate.capMinor;
    }
    return feeMinor;
  }

  function computeAchExample() {
    // Get largest invoice amount if available
    let achExampleAmount = 150000; // Default: $1,500
    if (summary?.largest?.amount_minor) {
      achExampleAmount = summary.largest.amount_minor;
    }

    // Compute both card and ACH fees for the example
    const cardFee = stripeFeesMinor(achExampleAmount, "online");
    const achFee = stripeFeesMinor(achExampleAmount, "bank");
    setAchExampleFee({ cardFee, achFee, amount: achExampleAmount });
  }

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);
      setPhase("loading");

      // Fetch settings
      const settingsRes = await request("/api/settings/money");
      setSettings(settingsRes);
      setAchNudgeMinimum(settingsRes?.ach_nudge_minimum ?? 50000);
      setBnplMinimum(settingsRes?.bnpl_minimum ?? 20000);

      // Fetch recent invoices for ACH example
      try {
        const invoicesRes = await request("/api/list/money/invoices");
        const invoices = invoicesRes?.rows || [];
        if (invoices.length > 0) {
          // Find the largest invoice by amount
          const largest = invoices.reduce((max, inv) =>
            (inv.amount_minor > max.amount_minor) ? inv : max
          );
          setSummary({ largest });
        } else {
          setSummary(null);
        }
      } catch (invoiceErr) {
        // If invoice fetch fails, just use default example
        setSummary(null);
      }

      // ★ Real capability status, live from Stripe's own Account object — replaces the embedded
      //   StripeSurface surface="payment_methods" that used to sit here (the maintainer's ruling, 28 Sep 2026).
      try {
        const accountRes = await request("/api/money/account");
        setCapabilities(accountRes?.capabilities ?? {});
      } catch {
        setCapabilities({});
      }

      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setPhase("denied");
        } else {
          setError(err.message || "Failed to load payment methods");
          setPhase("error");
        }
      } else {
        setError(err?.message ?? String(err));
        setPhase("error");
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveSetting(key, value) {
    try {
      if (key === "money.ach_nudge_minimum") {
        setSavingAch(true);
      } else if (key === "money.bnpl_minimum") {
        setSavingBnpl(true);
      }

      await request("/api/settings", {
        method: "POST",
        body: { key, value },
      });

      // Refresh settings
      const res = await request("/api/settings/money");
      setSettings(res);
      if (key === "money.ach_nudge_minimum") {
        setAchNudgeMinimum(res.ach_nudge_minimum ?? 50000);
      } else if (key === "money.bnpl_minimum") {
        setBnplMinimum(res.bnpl_minimum ?? 20000);
      }
    } catch (err) {
      setError(err?.message ?? "Failed to save setting");
    } finally {
      setSavingAch(false);
      setSavingBnpl(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (phase === "ready") {
      computeAchExample();
    }
  }, [summary, phase]);

  function formatCents(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function toggleFeesDetail() {
    setShowFeesDetail(!showFeesDetail);
  }

  // ── Handle phase-specific rendering ────────────────────────────────────────────────────────
  return (
    <ScreenState phase={phase} error={error}>
      <div className="payment-methods-screen" data-testid="money-payment-methods">
        {/* Header */}
        <div className="flex items-end gap-4 mb-4.5">
          <div className="flex-1">
            <h1 className="m-0 font-medium text-[24px] leading-none tracking-[-0.01em]">
              Ways people can pay you
            </h1>
            <p className="text-[13.5px] text-mute mt-1.25">
              Fifteen on. Bank transfer is the one most practices forget.
            </p>
          </div>
          <button
            className="h-9.5 px-[17px] rounded-lg border border-line-soft bg-white text-mute font-medium text-sm cursor-pointer hover:bg-brand-soft hover:text-brand"
            onClick={toggleFeesDetail}
          >
            What each one costs
          </button>
        </div>

        {/* Fee details panel */}
        {showFeesDetail && (
          <div className="mb-4.5 bg-white border border-line-soft rounded-lg p-4">
            <div className="font-medium text-sm mb-3">Fee rates by payment method:</div>
            <ul className="list-none p-0 m-0 space-y-2 text-[13px] text-ink-2">
              <li>Card (online): 2.9% + 30¢</li>
              <li>Card (in person): 2.7% + 5¢</li>
              <li>Bank transfer: 0.8% (max 5¢)</li>
            </ul>
          </div>
        )}

        {/* ACH Settings Section */}
        <div className="bg-white border border-line-soft rounded-xl p-[17px] mb-4.5">
          <div className="mb-3.5">
            <div className="text-[14.5px] font-medium text-ink block mb-1.5">
              <b>ACH Settings</b>
            </div>
            {achExampleFee && (
              <div className="text-[13px] text-mute leading-[1.5]">
                On a {formatCents(achExampleFee.amount)} package this is {formatCents(achExampleFee.cardFee)} against {formatCents(achExampleFee.achFee)}.
              </div>
            )}
          </div>

          <div className="space-y-3.5">
            <Field>
              <FieldLabel>Nudge threshold for ACH</FieldLabel>
              <FieldContent>
                <FieldMoney
                  valueMinor={achNudgeMinimum}
                  onValueMinorChange={(value) => {
                    setAchNudgeMinimum(value);
                    saveSetting("money.ach_nudge_minimum", value);
                  }}
                  disabled={savingAch}
                  currency="USD"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Minimum for BNPL</FieldLabel>
              <FieldContent>
                <FieldMoney
                  valueMinor={bnplMinimum}
                  onValueMinorChange={(value) => {
                    setBnplMinimum(value);
                    saveSetting("money.bnpl_minimum", value);
                  }}
                  disabled={savingBnpl}
                  currency="USD"
                />
              </FieldContent>
            </Field>
          </div>
        </div>

        {/* Payment methods enabled on your Stripe account — live, not an embed */}
        <div className="mb-4.5 bg-white border border-line-soft rounded-xl p-[17px]">
          <div className="font-medium text-[14.5px] text-ink mb-2.5">Enabled on your account</div>
          <div className="flex flex-wrap gap-1.5" data-testid="payment-method-capabilities">
            {Object.keys(capabilities).length === 0 ? (
              <span className="text-xs text-mute">No capability data yet.</span>
            ) : (
              Object.entries(capabilities)
                .filter(([, status]) => status !== "inactive")
                .map(([key, status]) => (
                  <span
                    key={key}
                    className={`inline-flex items-center h-6 px-2.25 rounded-sm text-xs font-medium ${status === "active" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}
                    data-testid={`capability-${key}`}
                  >
                    {key.replace(/_payments$/, "").replaceAll("_", " ")} — {status}
                  </span>
                ))
            )}
          </div>
        </div>

        {/* In Person Payment Methods */}
        <div className="bg-white border border-line-soft rounded-xl p-[17px]">
          <div className="font-medium text-[14.5px] text-ink mb-2.5">In person</div>
          <div className="space-y-0">
            <PaymentMethodRow
              label="Tap to Pay on iPhone"
              icon="A"
              iconBg="#111111"
              feeText="2.7% + 5¢"
              disabled={true}
              disabledReason="Set up on your phone in the Workbench app"
              testId="payment-method-row-tap-iphone"
            >
              <DisabledWithReason reason="Set up on your phone in the Workbench app" />
            </PaymentMethodRow>

            <PaymentMethodRow
              label="A card reader"
              icon="S"
              iconBg="#635BFF"
              feeText="2.7% + 5¢"
              actionLabel="Manage"
              actionHref="/money/readers"
              testId="payment-method-row-card-reader"
            />

            <PaymentMethodRow
              label="Virtual terminal"
              icon="S"
              iconBg="#635BFF"
              feeText="2.7% + 5¢"
              actionLabel="Use"
              actionHref="/money/virtual-terminal"
              testId="payment-method-row-virtual-terminal"
            />
          </div>
        </div>
      </div>
    </ScreenState>
  );
}
