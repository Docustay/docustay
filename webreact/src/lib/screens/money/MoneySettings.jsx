// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › SETTINGS — SETTINGS SCREEN FOR MONEY, INVOICES, DUNNING
// Built from webui/src/lib/screens/money/MoneySettings.svelte via MoneySettings.frame.html
// and SetMoney.frame.html
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function MoneySettings({ onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await request("/api/settings/money");
        setData(res);
      } catch (err) {
        console.error("Error fetching money settings:", err);
        setError(err);
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return <ScreenState phase="loading" />;
  }

  if (error) {
    return (
      <div className="p-0">
        <div className="bg-surface rounded-card border border-line">
          <div className="px-7.5 py-5.5 flex items-start gap-3 rounded-card border border-bad-soft bg-bad-soft text-xs text-bad" role="alert">
            <span className="flex-shrink-0 mt-0.5">⚠</span>
            <span className="flex-1">
              Error loading settings: {error.message || String(error)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <ScreenState phase="empty" empty="no-data" />
    );
  }

  return (
    <div className="p-0" data-testid="money-settings">
      {/* Header section */}
      <div className="px-7.5 pb-0 pt-6.5 mb-4.5">
        <h1 className="font-serif font-medium text-2xl tracking-tight m-0 mb-2">Money settings</h1>
        <p className="m-0 text-sm text-mute leading-relaxed">
          Some of this lives elsewhere. We'll take you there rather than keep two copies.
        </p>
      </div>

      {/* Getting paid section */}
      <div className="bg-surface rounded-card border border-line mb-4.5 mx-7.5">
        <div className="flex items-center gap-2.75 px-4.5 py-3.75 border-b border-hair">
          <h2 className="font-medium text-sm m-0 flex-1">Getting paid</h2>
          {data.connect?.state === "active" && (
            <span className="inline-flex items-center h-5.25 px-2.25 rounded-sm text-xs font-medium bg-ok-soft text-ok">
              Stripe connected
            </span>
          )}
          {data.connect?.connectedAt && (
            <span className="text-xs text-mute">
              Connected {new Date(data.connect.connectedAt + "T00:00:00Z").toLocaleDateString("en-US", { day: "numeric", month: "long" })}
            </span>
          )}
        </div>
        <div className="px-4.5 py-2.5">
          <div className="flex flex-col">
            {/* Stripe row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Stripe</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  Money lands in your bank, usually two days later. We never hold it.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {data.connect?.state === "active" ? (
                  <span className="inline-flex items-center h-5.25 px-2.25 rounded-sm text-xs font-medium bg-ok-soft text-ok">
                    Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center h-5.25 px-2.25 rounded-sm text-xs font-medium bg-warn-soft text-warn">
                    Not connected
                  </span>
                )}
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/connect")}
                >
                  Manage
                </button>
              </div>
            </div>

            {/* Ways people can pay you row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Ways people can pay you</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  Fourteen on. Bank transfer is on and saves you money on big invoices.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/payment-methods")}
                >
                  Open
                </button>
              </div>
            </div>

            {/* Bank account row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Bank account</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  First Republic •••• 8841
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/payout")}
                >
                  Change
                </button>
              </div>
            </div>

            {/* When you get paid row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">When you get paid</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  Daily, two working days behind.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/payout")}
                >
                  Change
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoices section */}
      <div className="bg-surface rounded-card border border-line mb-4.5 mx-7.5">
        <div className="flex items-center gap-2.75 px-4.5 py-3.75 border-b border-hair">
          <h2 className="font-medium text-sm m-0 flex-1">Invoices</h2>
        </div>
        <div className="px-4.5 py-2.5">
          <div className="flex flex-col">
            {/* When they're due row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">When they're due</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  {data.fields
                    ? data.fields
                        .filter((f) => f.key === "money.payment_terms_days")
                        .map((f) => `${f.value ?? 0} days from the day you send.`)
                        .join("")
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/edit-payment-terms")}
                >
                  Change
                </button>
              </div>
            </div>

            {/* Reminders row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Reminders</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  {data.fields
                    ? data.fields
                        .filter((f) => f.key === "money.reminder_days")
                        .map((f) => {
                          if (Array.isArray(f.value) && f.value.length > 0) {
                            return `${f.value.length} reminders on selected days.`;
                          }
                          return "Four: a week before, on the day, then 1 and 3 days late.";
                        })
                        .join("")
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/edit-reminders")}
                >
                  Change
                </button>
              </div>
            </div>

            {/* Numbering row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Numbering</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  {data.fields
                    ? data.fields
                        .filter((f) => f.key === "money.invoice_prefix")
                        .map((f) => `${f.value || "000001"}, going up. Next one is 000015.`)
                        .join("")
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/edit-numbering")}
                >
                  Change
                </button>
              </div>
            </div>

            {/* Tipping row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Tipping</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  Offered on invoices and in person.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {data.fields
                  ? data.fields
                      .filter((f) => f.key === "money.tipping")
                      .map((f) => (
                        <div
                          key="tipping-toggle"
                          className={`w-9 h-5.25 rounded-full flex-shrink-0 relative flex items-center transition-all ${
                            f.value?.enabled ? "bg-brand" : "bg-line-soft"
                          }`}
                        >
                          <div
                            className={`w-3.75 h-3.75 rounded-full bg-surface absolute transition-all ${
                              f.value?.enabled ? "left-0.75" : "right-0.75"
                            }`}
                          />
                        </div>
                      ))
                      .join("")
                  : ""}
              </div>
            </div>

            {/* Part payments row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Part payments</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  Off. Turning it on lets people pay an invoice in instalments you set.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {data.fields
                  ? data.fields
                      .filter((f) => f.key === "money.part_payments")
                      .map((f) => (
                        <div
                          key="part-payments-toggle"
                          className={`w-9 h-5.25 rounded-full flex-shrink-0 relative flex items-center transition-all ${
                            f.value ? "bg-brand" : "bg-line-soft"
                          }`}
                        >
                          <div
                            className={`w-3.75 h-3.75 rounded-full bg-surface absolute transition-all ${
                              f.value ? "left-0.75" : "right-0.75"
                            }`}
                          />
                        </div>
                      ))
                      .join("")
                  : ""}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* If a payment fails section */}
      <div className="bg-surface rounded-card border border-line mb-4.5 mx-7.5">
        <div className="flex items-center gap-2.75 px-4.5 py-3.75 border-b border-hair">
          <h2 className="font-medium text-sm m-0 flex-1">If a payment fails</h2>
        </div>
        <div className="px-4.5 py-2.5">
          <div className="flex flex-col">
            {/* Try again row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Try again</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  {data.fields
                    ? data.fields
                        .filter((f) => f.key === "money.dunning")
                        .map((f) => `Stripe retries the card on its own schedule. After ${f.value?.retries ?? 3} failed attempts we pause the subscription and open a task.`)
                        .join("")
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="inline-flex items-center justify-center gap-2 h-8 px-3.25 rounded-sm border border-line bg-surface text-ink-2 text-xs font-medium hover:border-brand hover:bg-brand-soft transition-all"
                  onClick={() => onNavigate?.("/settings/money/edit-dunning")}
                >
                  Change
                </button>
              </div>
            </div>

            {/* Tell them row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Tell them</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  Every time, with a link to fix the card.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-9 h-5.25 rounded-full flex-shrink-0 relative flex items-center bg-brand">
                  <div className="w-3.75 h-3.75 rounded-full bg-surface absolute left-0.75" />
                </div>
              </div>
            </div>

            {/* Tell you row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Tell you</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  On the first failure, not the third.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="w-9 h-5.25 rounded-full flex-shrink-0 relative flex items-center bg-brand">
                  <div className="w-3.75 h-3.75 rounded-full bg-surface absolute left-0.75" />
                </div>
              </div>
            </div>

            {/* Then pause it row */}
            <div className="flex items-start gap-4.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Then pause it</div>
                <div className="text-xs text-mute mt-1 leading-snug">
                  After the last try, the subscription pauses rather than piling up debt.
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {data.fields
                  ? data.fields
                      .filter((f) => f.key === "money.dunning")
                      .map((f) => (
                        <div
                          key="dunning-toggle"
                          className={`w-9 h-5.25 rounded-full flex-shrink-0 relative flex items-center transition-all ${
                            f.value?.pause_after ? "bg-brand" : "bg-line-soft"
                          }`}
                        >
                          <div
                            className={`w-3.75 h-3.75 rounded-full bg-surface absolute transition-all ${
                              f.value?.pause_after ? "left-0.75" : "right-0.75"
                            }`}
                          />
                        </div>
                      ))
                      .join("")
                  : ""}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lives somewhere else section */}
      <div className="bg-surface rounded-card border border-line mb-4.5 mx-7.5">
        <div className="flex items-center gap-2.75 px-4.5 py-3.75 border-b border-hair">
          <h2 className="font-medium text-sm m-0 flex-1">Lives somewhere else</h2>
        </div>
        <div className="px-4.5 py-2.5">
          <div className="flex flex-col">
            {/* Your logo on invoices */}
            <div className="flex items-center gap-3.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Your logo on invoices</div>
                <div className="text-xs text-mute mt-1">Branding</div>
              </div>
              <div className="flex-shrink-0 text-mute text-xs">›</div>
            </div>

            {/* Who on your team can refund */}
            <div className="flex items-center gap-3.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Who on your team can refund</div>
                <div className="text-xs text-mute mt-1">Team and roles</div>
              </div>
              <div className="flex-shrink-0 text-mute text-xs">›</div>
            </div>

            {/* What tax you charge */}
            <div className="flex items-center gap-3.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">What tax you charge</div>
                <div className="text-xs text-mute mt-1">Catalogue</div>
              </div>
              <div className="flex-shrink-0 text-mute text-xs">›</div>
            </div>

            {/* Which emails go out about money */}
            <div className="flex items-center gap-3.5 px-0 py-3.75 border-b border-hair last:border-b-0">
              <div className="flex-1">
                <div className="font-medium text-sm">Which emails go out about money</div>
                <div className="text-xs text-mute mt-1">Notifications</div>
              </div>
              <div className="flex-shrink-0 text-mute text-xs">›</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
