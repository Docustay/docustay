// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AutomationsPageAutomationsPageTable — the automations list table component. Ported from
// webui/src/lib/screens/AutomationsPage.svelte lines 74-189. Uses LedgerPage archetype with
// custom row layouts for running/off/info sections. Renders StatusBadge, DisabledWithReason,
// and PromptCard for special automation types.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";

export default function AutomationsPageAutomationsPageTable({
  automations = [],
  loading = false,
  error = null,
  denied = false,
  deniedReason = null,
  savingKey = null,
  totalActions = 0,
  runningAutomations = [],
  offAutomations = [],
  headlineNumber = "zero",
  enableReviewAsk = null,
  handleRowClick = null,
}) {
  if (loading) {
    return (
      <LedgerPage
        title="Things that happen on their own"
        summary={automationsSummary(headlineNumber, totalActions)}
        testId="automations-page"
        loading
      />
    );
  }

  if (denied) {
    return (
      <LedgerPage title="Things that happen on their own" summary={automationsSummary(headlineNumber, totalActions)} testId="automations-page">
        {/* ★ the maintainer, 1 Oct 2026 — owner-access audit: the hardcoded "ask an owner or admin" line
           used to show regardless of what actually refused the request — nonsensical for the one
           person who IS the owner. The server's own reason, when present, is specific and real. */}
        <ScreenState phase="denied" reason={deniedReason ?? "Automations are practice policy — ask an owner or admin"} />
      </LedgerPage>
    );
  }

  if (error) {
    return (
      <LedgerPage title="Things that happen on their own" summary={automationsSummary(headlineNumber, totalActions)} testId="automations-page">
        <ScreenState phase="error" error={{ message: error }} />
      </LedgerPage>
    );
  }

  return (
    <LedgerPage title="Things that happen on their own" summary={automationsSummary(headlineNumber, totalActions)} testId="automations-page">
      <div className="flex flex-col gap-6" data-testid="automations-content">
        {runningAutomations.length > 0 && (
          <div className="flex flex-col gap-0">
            <h2 className="mb-3 text-ui font-semibold text-ink">Running</h2>
            <div className="flex flex-col gap-0 rounded-card border border-line bg-surface overflow-hidden">
              {runningAutomations.map((automation) => (
                <div
                  key={automation.key}
                  className="flex items-center justify-between gap-4 border-b border-hair px-4 py-4 cursor-pointer transition-colors hover:bg-surface-2 last:border-b-0"
                  role="button"
                  tabIndex={0}
                  data-testid={`automation-${automation.key}`}
                  onClick={() => handleRowClick?.(automation.key)}
                  onKeyDown={(e) => e.key === "Enter" && handleRowClick?.(automation.key)}
                >
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="font-semibold text-ui text-ink">{automation.name}</div>
                    <div className="text-meta text-mute">{automation.behaviour}</div>
                  </div>
                  <StatusBadge label={automation.week_count} tone="ok" testId={`automation-badge-${automation.key}`} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-0">
          <h2 className="mb-3 text-ui font-semibold text-ink">Off</h2>
          <div className="flex flex-col gap-0 rounded-card border border-line bg-surface overflow-hidden">
            {offAutomations.map((automation) => {
              if (automation.key === "ads.keyword_pause") {
                return (
                  <DisabledWithReason
                    key={automation.key}
                    disabled
                    reason="Needs Google Ads connected — this rule only ever proposes, it never acts"
                    testId={`automation-disabled-${automation.key}`}
                  >
                    {({ disabled }) => (
                      <div
                        className="flex items-center justify-between gap-4 border-b border-hair px-4 py-4 opacity-60 last:border-b-0"
                        data-testid={`automation-${automation.key}`}
                      >
                        <div className="flex flex-col gap-1 flex-1">
                          <div className="font-semibold text-ui text-ink">{automation.name}</div>
                          <div className="text-meta text-mute">{automation.offCase || ""}</div>
                        </div>
                        <div className="h-5.25 w-9 rounded-full bg-toggle-off flex-shrink-0 opacity-50 relative">
                          <div className="absolute left-0.75 top-0.75 h-3.75 w-3.75 rounded-full bg-white" />
                        </div>
                      </div>
                    )}
                  </DisabledWithReason>
                );
              }

              if (automation.key === "run.review_ask") {
                return (
                  <div key={automation.key} className="border-b border-hair last:border-b-0">
                    <PromptCard
                      icon="✓"
                      tone="act"
                      headline="Ask for a review after every session"
                      why="The three practices ranking above you all do this."
                      action={{ label: "Turn on", onClick: enableReviewAsk }}
                      busy={savingKey === "run.review_ask"}
                      testId="automation-review-ask-prompt"
                    />
                  </div>
                );
              }

              return (
                <div
                  key={automation.key}
                  className="flex items-center justify-between gap-4 border-b border-hair px-4 py-4 cursor-pointer transition-colors hover:bg-surface-2 last:border-b-0"
                  role="button"
                  tabIndex={0}
                  data-testid={`automation-${automation.key}`}
                  onClick={() => handleRowClick?.(automation.key)}
                  onKeyDown={(e) => e.key === "Enter" && handleRowClick?.(automation.key)}
                >
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="font-semibold text-ui text-ink">{automation.name}</div>
                    <div className="text-meta text-mute">{automation.offCase || ""}</div>
                  </div>
                  <div className="h-5.25 w-9 rounded-full bg-toggle-off flex-shrink-0 relative">
                    <div className="absolute left-0.75 top-0.75 h-3.75 w-3.75 rounded-full bg-white" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-0">
          <h2 className="mb-3 text-ui font-semibold text-ink">Worth knowing</h2>
          <div className="flex flex-col gap-0 rounded-card border border-line bg-surface overflow-hidden">
            <div className="flex flex-col gap-0 border-b border-hair px-4 py-4 last:border-b-0">
              <div className="font-semibold text-ui text-ink">Nothing sends without a rule</div>
              <div className="text-meta text-mute mt-1">Every one of these is something you switched on, and you can switch it off here.</div>
            </div>
            <div className="flex flex-col gap-0 border-b border-hair px-4 py-4 last:border-b-0">
              <div className="font-semibold text-ui text-ink">Nothing is charged automatically</div>
              <div className="text-meta text-mute mt-1">A reminder is a message. Taking money always needs you, or a card they already agreed to.</div>
            </div>
          </div>
        </div>
      </div>
    </LedgerPage>
  );
}

/** "Ten running. Nothing done for you yet this month." — capitalised, and plain about zero (F144). */
function automationsSummary(headlineNumber, totalActions) {
  const n = String(headlineNumber || "zero");
  const lead = n === "zero" ? "None running." : `${n.charAt(0).toUpperCase()}${n.slice(1)} running.`;
  const did = !totalActions ? "Nothing done for you yet this month." : `They did ${totalActions} ${totalActions === 1 ? "thing" : "things"} for you this month.`;
  return `${lead} ${did}`;
}
