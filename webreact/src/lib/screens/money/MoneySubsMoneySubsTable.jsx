// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.052.T1 — MoneySubs › MoneySubsMoneySubsTable
// Ported from webui/src/lib/screens/money/MoneySubs.svelte:94-232
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ProgramFilter from "@/lib/programs/ProgramFilter.jsx";
import { ProgramChips } from "@/lib/programs/ProgramChip.jsx";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

export default function MoneySubsMoneySubsTable({
  programFilter = "all",
  onProgramFilter = null,
  onNavigate = null,
  onStartNew = null,
  phase = "loading",
  summary = null,
  subscriptions = [],
  error = null,
  activeView = "running",
  dunningConfig = { retries: 3, days: 10, pause_after: true },
  expiredCardPerson = null,
  fetchData = () => {},
  handleView = () => {},
  handleNavigateToUpdateCard = () => {},
  formatMoney = (minor) => `$${(minor / 100).toFixed(2)}`,
  filteredSubs = [],
  summaryText = "",
  bulk = null,
}) {
  // Map state to tone for StatusBadge
  const getStateVariant = (state) => {
    if (state === "active") return "ok";
    if (state === "paused") return "neutral";
    return "neutral";
  };

  // Get display label for state
  const getStateLabel = (state) => {
    if (state === "active") return "Running";
    if (state === "paused") return "Paused";
    return "Ended";
  };

  return (
    <ScreenState
      phase={phase}
      error={error}
      reason={error?.kind === "PermissionDenied" ? `Coach does not have access to Money` : undefined}
      empty="No subscriptions running"
      subject="Subscriptions"
      onRetry={fetchData}
      testIds={{
        empty: "money-subs-empty",
        loading: "money-subs-loading",
        error: "money-subs-error",
        denied: "money-subs-denied",
      }}
    >
      <LedgerPage
        title="Subscriptions"
        summary={summaryText}
        primary={{ label: "Start one", onClick: () => onStartNew?.() }}
        views={[
          { key: "running", label: "Running" },
          { key: "paused", label: "Paused" },
          { key: "ended", label: "Ended" },
        ]}
        activeView={activeView}
        onView={handleView}
        testId="money-subs"
      >
        {filteredSubs.length > 0 && (
          <>
            {/* Figures strip: Running, Monthly, Cards expiring */}
            <div className="mb-4.5 flex overflow-hidden rounded-card border border-line bg-surface">
              <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
                <div className="font-serif text-[34px] font-normal leading-none tracking-tight">
                  {summary?.running || 0}
                </div>
                <div className="mt-1.75 text-control text-mute">running</div>
                <div className="mt-1.25 text-xs text-ok">↑ two this quarter</div>
              </div>
              <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
                <div className="font-serif text-[34px] font-normal leading-none tracking-tight">
                  {formatMoney(summary?.monthlyMinor || 0)}
                </div>
                <div className="mt-1.75 text-control text-mute">a month</div>
                <div className="mt-1.25 text-xs text-mute">Before fees</div>
              </div>
              <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
                <div className="font-serif text-[34px] font-normal leading-none tracking-tight">
                  {summary?.cardsExpiring || 0}
                </div>
                <div className="mt-1.75 text-control text-mute">card expiring</div>
                {summary?.cardsExpiring > 0 && (
                  <div className="mt-1.25 text-xs text-bad">↓ in October</div>
                )}
              </div>
            </div>

            {onProgramFilter && <div className="mb-3"><ProgramFilter value={programFilter} onChange={onProgramFilter} testId="subs-program-filter" /></div>}

            {/* Table */}
            {bulk?.bulkBar}
            <div className="mb-4.5 overflow-hidden rounded-card border border-line bg-surface">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="h-9 border-b border-line bg-surface-2">
                    <BulkHeadCell bulk={bulk} rows={filteredSubs} />
                    <th className="px-4 text-left text-xs font-medium text-mute">Who</th>
                    <th className="px-4 text-left text-xs font-medium text-mute">Plan</th>
                    <th className="px-4 text-left text-xs font-medium text-mute">Each month</th>
                    <th className="px-4 text-left text-xs font-medium text-mute">Next payment</th>
                    <th className="px-4 text-left text-xs font-medium text-mute">How they pay</th>
                    <th className="px-4 text-left text-xs font-medium text-mute">Program</th>
                    <th className="px-4 text-left text-xs font-medium text-mute">State</th>
                    <RowMenuHeadCell bulk={bulk} />
                  </tr>
                </thead>
                <tbody>
                  {/* ★ the maintainer, 1 Oct 2026 — card audit, FOUND LIVE: this whole row read field names
                     (`payer_name`, `plan_name`, `amountMinor`, `nextPaymentDate`, `paymentMethod`,
                     `payer_initials`) that `subscriptionsListLive` (src/money/subscriptions.mjs)
                     has never returned — the real shape is `customerName`/`items`/`monthlyMinor`/
                     `currentPeriodEnd`/`card`. Every column except State and the row link was
                     rendering its own fallback ("—"/"Plan"/"?") for every subscription, always —
                     not a card-specific gap, the whole table was wired to a shape nothing sends. */}
                  {filteredSubs.map((sub) => {
                    const name = sub.customerName || "—";
                    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
                    const planName = sub.items?.[0]?.description || "Plan";
                    const nextPayment = sub.currentPeriodEnd
                      ? new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                      : "—";
                    const cardLabel = sub.card
                      ? `${sub.card.brand?.[0]?.toUpperCase() ?? ""}${sub.card.brand?.slice(1) ?? ""} •••• ${sub.card.lastFour}`
                      : "No card on file";
                    return (
                      <tr
                        key={sub.id}
                        onClick={() => onNavigate?.(`/money/subscriptions/${sub.id}`)}
                        className="h-11.5 border-b border-hair last:[&>td]:border-b-0 cursor-pointer transition-colors hover:bg-surface-soft"
                      >
                        <BulkRowCell bulk={bulk} id={sub.id} />
                        <td className="px-4 text-sm text-ink">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-brand">
                              {initials}
                            </span>
                            <span>{name}</span>
                          </div>
                        </td>
                        <td className="px-4 text-sm text-ink">{planName}</td>
                        <td className="px-4 text-sm text-ink tabular-nums">{formatMoney(sub.monthlyMinor)}</td>
                        <td className="px-4 text-sm text-ink tabular-nums">{nextPayment}</td>
                        <td className={`px-4 text-sm ${sub.card ? "text-ink" : "text-mute"}`}>{cardLabel}</td>
                        <td className="px-4 text-sm text-ink"><ProgramChips ids={[sub.programId].filter(Boolean)} /></td>
                        <td className="px-4 text-sm text-ink">
                          <StatusBadge
                            label={getStateLabel(sub.state)}
                            tone={getStateVariant(sub.state)}
                            testId={`money-sub-state-${sub.id}`}
                          />
                        </td>
                        <RowMenuCell bulk={bulk} row={sub} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Content area with cards and dunning strip */}
            <div className="flex gap-5.5 items-start">
              <div className="flex-1 min-w-0">
                {/* Expiring card prompt */}
                {expiredCardPerson && (
                  <div className="mb-4.5">
                    <PromptCard
                      icon="$"
                      tone="warn"
                      headline={`${expiredCardPerson.name}'s card expires before next payment but one`}
                      why="October's will go through, November's won't. Asking now is easier than chasing a failure."
                      action={{
                        label: "Ask him to update it",
                        onClick: () => handleNavigateToUpdateCard(expiredCardPerson.id),
                      }}
                      onDismiss={() => { /* parent handles dismiss */ }}
                    />
                  </div>
                )}
              </div>

              <div className="w-80 flex-shrink-0">
                {/* If a payment fails */}
                <div className="mb-4.5 overflow-hidden rounded-card border border-line bg-surface">
                  <div className="flex items-center gap-2.5 border-b border-hair px-4.25 py-3.5">
                    <b className="text-sm font-semibold">If a payment fails</b>
                  </div>
                  <div className="px-4.25 py-3.5">
                    <div className="flex flex-col gap-0 py-2.75 border-b border-hair last:border-b-0">
                      <span className="font-medium text-sm text-ink">
                        Tried {dunningConfig.retries} times
                      </span>
                      <span className="text-xs text-mute mt-0.5">Over {dunningConfig.days} days</span>
                    </div>
                    <div className="flex flex-col gap-0 py-2.75 border-b border-hair last:border-b-0">
                      <span className="font-medium text-sm text-ink">
                        They're told each time
                      </span>
                      <span className="text-xs text-mute mt-0.5">With a link to fix the card</span>
                    </div>
                    <div className="flex flex-col gap-0 py-2.75 border-b border-hair last:border-b-0">
                      <span className="font-medium text-sm text-ink">
                        You're told on the first
                      </span>
                      <span className="text-xs text-mute mt-0.5">Not the third</span>
                    </div>
                    <div className="flex flex-col gap-0 py-2.75 border-b border-hair last:border-b-0">
                      <span className="font-medium text-sm text-ink">
                        Then it pauses
                      </span>
                      <span className="text-xs text-mute mt-0.5">Rather than piling up debt</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </LedgerPage>
    </ScreenState>
  );
}
