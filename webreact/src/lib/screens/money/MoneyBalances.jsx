// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › BALANCES — BALANCES, MONTHLY CHART, AND INSTANT PAYOUT SCREEN
// Built from webui/src/lib/screens/money/MoneyBalances.svelte via StripeBalances.frame.html
// and StripeInstantPayout.frame.html.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import MonitorPage from "@/lib/components/kit/archetypes/MonitorPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

export default function MoneyBalances({ onNavigate }) {
  const [balances, setBalances] = useState({
    readyMinor: 0,
    clearingMinor: 0,
    heldMinor: 0,
    months: [],
    bank: null,
    payoutSchedule: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        setPhase("loading");
        const res = await request("/api/money/balances");
        setBalances(res || {
          readyMinor: 0,
          clearingMinor: 0,
          heldMinor: 0,
          months: [],
          bank: null,
          payoutSchedule: null,
        });
        setPhase("ready");
      } catch (err) {
        if (err?.status === 403) {
          setPhase("denied");
        } else {
          setError(err);
          setPhase("error");
        }
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  function formatMoney(minor) {
    return `$${(minor / 100).toFixed(2)}`;
  }

  function computeInstantPayoutCost() {
    const costMinor = Math.round(balances.readyMinor * 0.015);
    const weeklyCostMinor = costMinor * 52;
    return {
      costFormatted: `$${(costMinor / 100).toFixed(2)}`,
      weeklyCostFormatted: `$${(weeklyCostMinor / 100).toFixed(0)}`,
    };
  }

  function formatMonthLabel(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr + "T00:00:00Z");
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }

  const maxMonthMinor = balances.months.length > 0
    ? Math.max(...balances.months.map((m) => m.amountMinor))
    : 1;

  return (
    <ScreenState phase={phase} error={error}>
      <section className="p-0" data-testid="money-balances">
        <MonitorPage
          title="Your balance"
          summary={`${formatMoney(balances.readyMinor)} on its way, ${formatMoney(balances.clearingMinor)} still clearing.`}
          testId="money-balances-monitor"
        >
          {/* Info band */}
          <div className="mb-5 flex items-start gap-3 rounded-card border border-line bg-brand-soft px-3.5 py-2.75 text-xs text-brand">
            <span className="mt-0.5 flex-shrink-0">⚬</span>
            <span className="flex-1">
              <b>None of this money is ours.</b> It sits with Stripe between your client paying and your bank receiving. We could not hold it even if we wanted to, which is why there is nothing here to withdraw.
            </span>
          </div>

          {/* Balance strip — dense labelled strip with thin dividers */}
          <div className="mb-5 flex overflow-hidden rounded-card border border-line bg-surface">
            <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
              <div className="font-serif text-[32px] font-normal leading-none tracking-tight">
                {formatMoney(balances.readyMinor)}
              </div>
              <div className="mt-2 text-sm text-mute">ready to pay out</div>
              <div className="mt-2.5 text-xs text-ink-2 leading-relaxed">
                Leaves Thursday. Payments from Monday and Tuesday.
              </div>
            </div>
            <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
              <div className="font-serif text-[32px] font-normal leading-none tracking-tight">
                {formatMoney(balances.clearingMinor)}
              </div>
              <div className="mt-2 text-sm text-mute">still clearing</div>
              <div className="mt-2.5 text-xs text-ink-2 leading-relaxed">
                Cards take two working days to settle. Bank transfers take four.
              </div>
            </div>
            <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
              <div className="font-serif text-[32px] font-normal leading-none tracking-tight">
                {formatMoney(balances.heldMinor)}
              </div>
              <div className="mt-2 text-sm text-mute">held back</div>
              <div className="mt-2.5 text-xs text-ink-2 leading-relaxed">
                Stripe holds nothing from you. New accounts sometimes see a reserve here.
              </div>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="flex gap-5.5">
            {/* Left column */}
            <div className="flex-1 min-w-0">
              {/* Monthly chart */}
              <div className="mb-4.5 rounded-card border border-line bg-surface">
                <div className="flex items-center gap-2.5 border-b border-hair px-4.25 py-3.5">
                  <b className="text-sm font-semibold flex-1">What has landed, month by month</b>
                  <span className="text-xs text-mute">
                    {formatMoney(balances.months.reduce((sum, m) => sum + m.amountMinor, 0))} over {balances.months.length} months
                  </span>
                </div>
                <div className="px-4.25 py-3.5">
                  <div className="flex items-end gap-2.25 h-52 pt-3.5">
                    {balances.months.map((month, i) => (
                      <div key={month.month || i} className="flex-1 flex flex-col items-center gap-1.5">
                        <div className="text-xs text-ink-2 font-serif font-normal">
                          {formatMoney(month.amountMinor)}
                        </div>
                        <div
                          className="w-full rounded-t bg-brand-soft"
                          style={{ minHeight: "2px", height: `${(month.amountMinor / maxMonthMinor) * 100}%` }}
                        />
                        <div className="text-xs text-mute">
                          {formatMonthLabel(month.month)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            {/* Right column */}
            <div className="w-80 flex-shrink-0">
              {/* How this works — real bank + schedule from Stripe, not placeholder text */}
              <div className="mb-4.5 rounded-card border border-line bg-surface">
                <div className="flex items-center gap-2.5 border-b border-hair px-4.25 py-3.5">
                  <b className="text-sm font-semibold">How this works</b>
                </div>
                <div className="px-4.25 py-3.5">
                  <div className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        {balances.payoutSchedule?.interval
                          ? `Paid out ${balances.payoutSchedule.interval}${balances.payoutSchedule.interval === "weekly" && balances.payoutSchedule.weekly_anchor ? ` on ${balances.payoutSchedule.weekly_anchor}` : ""}`
                          : "Payout schedule"}
                      </div>
                      <div className="text-xs text-mute mt-1.5">Two working days behind, automatically</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        {balances.bank ? `To ${balances.bank.name} • ${balances.bank.last4}` : "No payout bank on file"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0">
                    <div className="flex-1">
                      <div className="font-medium text-sm">Weekends and holidays</div>
                      <div className="text-xs text-mute mt-1.5">
                        Banks don't move money then. Friday's payout lands Tuesday on a long weekend.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Instant payout section — never drawn dead: charges/payouts are on hold (M4-M7), so
                  this is a real DisabledWithReason, not a button that would fail on click. */}
              <div className="rounded-card border border-line bg-surface">
                <div className="flex items-center gap-2.5 border-b border-hair px-4.25 py-3.5">
                  <b className="text-sm font-semibold">Need it sooner?</b>
                </div>
                <div className="px-4.25 py-3.5">
                  {balances.readyMinor > 0 && (
                    <div className="bg-warn-soft rounded-sm p-3.25 mb-3 text-xs text-warn leading-relaxed">
                      <b>{computeInstantPayoutCost().costFormatted} to have it three days early.</b> Worth it if payroll is tomorrow. Not worth it as a habit — doing this weekly would cost you about {computeInstantPayoutCost().weeklyCostFormatted} a year.
                    </div>
                  )}
                  <DisabledWithReason disabled reason="Charges and instant payouts are on hold for now.">
                    <Button variant="outline" data-testid="instant-payout-button">Get it sooner</Button>
                  </DisabledWithReason>
                </div>
              </div>
            </div>
          </div>
        </MonitorPage>
      </section>
    </ScreenState>
  );
}
