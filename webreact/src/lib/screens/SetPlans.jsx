// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Task 6.5 / 06-settings.md §2.7, §9, §11 — `/settings/plans` (`SetPlans`), THE A11 REBUILD.
//
// ★★★ BUILT FROM `specs/mockups/SetPlans.frame.html`, PORTED EXACTLY: breadcrumb → h1 → subtitle →
//     a 4-column grid of plan cards (Solo / Practice / Group / Enterprise) → the extra-seats /
//     yearly-discount footer note.
//
// ★ NO MONTHLY/YEARLY TOGGLE — the frame draws none. Each card shows the monthly figure with the
//   yearly total as a caption ("$390 billed yearly"), exactly as the frame does; "Choose {plan}"
//   sends `interval: "monthly"` to `POST /api/settings/plans/checkout-session`, which is the only
//   interval the frame's own buttons could mean. Adding a toggle control that is not in the frame
//   would be interpreting the screen rather than building it — flagged in the build report as a
//   design note, not a silent guess.
//
// ★ `view` IS ALREADY LOADED before this component mounts — see `SetBilling.svelte`'s header note
//   on `Screen.svelte`'s own loading/error/no-permission phases running upstream of "dedicated".
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Alert, AlertTitle } from "@/lib/components/ui/alert.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";

export default function SetPlans({ view = null, rank = null, onDone = null }) {
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState(null);

  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");
  const plans = view?.plans ?? [];
  const current = view?.current ?? null;

  function money(minor) {
    if (minor == null) return null;
    const dollars = minor / 100;
    const s = dollars.toLocaleString("en-US", {
      minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
      maximumFractionDigits: 2,
    });
    return `$${s}`;
  }

  function seatsLabel(plan) {
    if (plan.seats == null) return `${plan.key === "enterprise" ? "16+" : "Unlimited"} staff`;
    return plan.key === "practice" || plan.key === "group"
      ? `Up to ${plan.seats} staff seats`
      : `${plan.seats} staff seat${plan.seats === 1 ? "" : "s"}`;
  }

  async function choose(plan) {
    if (busyKey || !isAdmin) return;
    if (plan.key === "enterprise") return; // "Talk to us" — never a self-serve purchase.
    setBusyKey(plan.key);
    setError(null);
    try {
      const { url } = await api.planCheckoutSession({ planKey: plan.key, interval: "monthly" });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col max-w-[980px]" data-testid="settings-plans">
      <p className="m-0 text-xs text-[var(--color-structure-600)]">
        <a href="/settings" className="text-[var(--color-action-600)] no-underline hover:text-[var(--color-action-700)]">Settings</a> › Plan and billing
      </p>
      <h1 className="mt-1 mb-0 text-2xl font-medium tracking-tighter text-[var(--color-structure-900)]">
        Choose a plan
      </h1>
      <p className="mt-1.5 mb-4 text-sm text-[var(--color-structure-600)]">
        Every plan has every feature. Plans differ by staff seats and AI drafts.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4" data-testid="plans-error">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {!isAdmin && (
        <p className="text-xs text-[var(--color-structure-600)] mb-4" data-testid="plans-readonly">
          You can see plans but not change them. Choosing a plan is an admin action.
        </p>
      )}

      {plans.length === 0 ? (
        <p className="text-xs text-[var(--color-structure-600)]" data-testid="plans-empty">
          No plans to show right now.
        </p>
      ) : (
        <div className="grid grid-cols-4 md:grid-cols-2 sm:grid-cols-1 gap-[14px] mb-6" data-testid="plans-grid">
          {plans.map((plan) => {
            const isCurrent = plan.key === current;
            return (
              <div
                key={plan.key}
                className={`border rounded-[16px] p-5 flex flex-col gap-2.5 relative min-w-0 ${
                  isCurrent ? "border-2 border-[var(--color-action-600)]" : "border border-[var(--color-structure-200)]"
                }`}
                data-testid={`plan-card-${plan.key}`}
              >
                {isCurrent && (
                  <Badge
                    variant="default"
                    className="absolute -top-3 left-4 bg-[var(--color-action-50)] text-[var(--color-signer-practice-ink)]"
                    data-testid={`plan-current-${plan.key}`}
                  >
                    Current
                  </Badge>
                )}
                <span className="text-base font-semibold text-[var(--color-structure-900)]">
                  {plan.name}
                </span>
                {plan.monthlyPriceMinor != null ? (
                  <>
                    <span className="flex items-baseline gap-1">
                      <Figure size="lg">{money(plan.monthlyPriceMinor)}</Figure>
                      <span className="text-xs text-[var(--color-structure-600)]"> / month</span>
                    </span>
                    <span className="text-xs text-[var(--color-structure-600)]">
                      {money(plan.yearlyPriceMinor)} billed yearly
                    </span>
                  </>
                ) : (
                  <>
                    <Figure size="lg">Custom</Figure>
                    <span className="text-xs text-[var(--color-structure-600)]">16+ staff</span>
                  </>
                )}
                <div className="flex flex-col gap-1.5 py-3 border-t border-[var(--color-structure-150)] text-xs text-[var(--color-structure-900)]">
                  {plan.monthlyPriceMinor != null ? (
                    <>
                      <span>{seatsLabel(plan)}</span>
                      <span>{plan.aiDrafts} AI drafts a month</span>
                      <span>Unlimited clients, bookings, documents</span>
                      <span>Every feature included</span>
                      <span>No fees on client payments</span>
                    </>
                  ) : (
                    <span>Seats and AI to fit</span>
                  )}
                </div>
                {plan.key === "enterprise" ? (
                  <Button variant="outline" className="w-full" data-testid="plan-choose-enterprise">
                    Talk to us
                  </Button>
                ) : isCurrent ? (
                  <Button variant="outline" className="w-full" disabled data-testid={`plan-choose-${plan.key}`}>
                    Your plan
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    disabled={!isAdmin || busyKey === plan.key}
                    data-testid={`plan-choose-${plan.key}`}
                    onClick={() => choose(plan)}
                  >
                    {busyKey === plan.key ? "Working…" : `Choose ${plan.name}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3.5 mb-0 text-xs text-[var(--color-structure-600)]">
        Extra seats $25 a month each. Yearly = 2 months free.
      </p>
    </div>
  );
}
