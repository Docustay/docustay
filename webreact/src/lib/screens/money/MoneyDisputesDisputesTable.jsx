// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MoneyDisputesDisputesTable — the disputes table component extracted from MoneyDisputes
// Built from webui/src/lib/screens/money/MoneyDisputes.svelte:99-193
// Uses: LedgerPage, DataTable, StripeSurface, PromptCard
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

export default function MoneyDisputesDisputesTable({
  data,
  handleDispute,
  summaryText,
  getStateClass,
  getStateLabel,
  bulk = null,
}) {
  const [wonTipDismissed, setWonTipDismissed] = useState(false);
  return (
    <LedgerPage title="Disputes" summary={summaryText}>
      {/* Three-column figures strip */}
      <div className="mb-5 flex gap-0 overflow-hidden rounded-card border border-line bg-surface">
        <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
          <div className="font-fraunces text-[34px] font-normal -tracking-0.02 leading-none">{data.open}</div>
          <div className="mt-1.75 text-sm text-mute">open right now</div>
          {data.open > 0 && data.rows.length > 0 && (() => {
            const firstOpen = data.rows.find(
              (r) => r.state === "warning_under_review" || r.state === "under_review" || r.state === "evidence_submitted"
            );
            if (firstOpen) {
              return (
                <div className="mt-1.25 text-xs text-bad">
                  ${(firstOpen.amountMinor / 100).toFixed(2)}, answer by{" "}
                  {firstOpen.evidenceDueBy
                    ? new Date(firstOpen.evidenceDueBy).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}
                </div>
              );
            }
            return null;
          })()}
        </div>
        <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
          <div className="font-fraunces text-[34px] font-normal -tracking-0.02 leading-none">
            {data.wonThisYear} of {data.wonThisYear + data.lostThisYear || 0}
          </div>
          <div className="mt-1.75 text-sm text-mute">won this year</div>
          <div className="mt-1.25 text-xs text-ok">
            {data.wonThisYear > 0 ? "All answered with attendance records" : "No wins yet"}
          </div>
        </div>
        <div className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0">
          <div className="font-fraunces text-[34px] font-normal -tracking-0.02 leading-none">
            ${((data.open + data.wonThisYear + data.lostThisYear) * 15).toFixed(0)}
          </div>
          <div className="mt-1.75 text-sm text-mute">in dispute fees</div>
          <div className="mt-1.25 text-xs text-ink-2">$15 each, win or lose</div>
        </div>
      </div>

      {/* Information banner */}
      <div className="mb-4.5 flex gap-2.5 items-center rounded-control border border-[#E1DFFA] bg-[#F4F3FE] px-3.5 py-2.75 text-xs text-[#3B3A6B] leading-relaxed">
        <span>◯</span>
        <span>
          <b>The bank decides, not Stripe and not us.</b> It can take up to 75 days. What we can do
          is make sure the evidence goes in complete and on time, which is what decides most of them.
        </span>
      </div>

      {/* Disputes table */}
      {data.rows && data.rows.length > 0 && (
        <>
          {bulk?.bulkBar}
          <div className="overflow-auto rounded-card border border-line bg-surface mb-5">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <BulkHeadCell bulk={bulk} rows={data.rows} />
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Amount
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Who
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    What they told their bank
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Opened
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    Answer by
                  </th>
                  <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute">
                    State
                  </th>
                  {bulk?.selectable ? <RowMenuHeadCell bulk={bulk} /> : <th className="h-9.5 border-b border-line bg-surface-2 px-4 text-left text-caption font-medium text-mute" />}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((dispute) => (
                  <tr
                    key={dispute.id}
                    className="last:[&>td]:border-b-0"
                  >
                    <BulkRowCell bulk={bulk} id={dispute.id} />
                    <td className="h-11.5 border-b border-hair px-4 text-ui text-ink font-variant-numeric tabular-nums">
                      ${(dispute.amountMinor / 100).toFixed(2)}
                    </td>
                    <td className="h-11.5 border-b border-hair px-4 text-ui text-ink">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-soft text-blue text-caption font-medium">
                          {dispute.customerInitials || "?"}
                        </span>
                        {dispute.customerName || "Unknown"}
                      </div>
                    </td>
                    <td className="h-11.5 border-b border-hair px-4 text-ui text-ink">
                      {dispute.reason || "—"}
                    </td>
                    <td className="h-11.5 border-b border-hair px-4 text-ui text-ink font-variant-numeric tabular-nums">
                      {dispute.createdAt
                        ? new Date(dispute.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="h-11.5 border-b border-hair px-4 text-ui text-ink font-variant-numeric tabular-nums">
                      {dispute.evidenceDueBy
                        ? new Date(dispute.evidenceDueBy).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="h-11.5 border-b border-hair px-4 text-ui text-ink">
                      <StatusBadge
                        label={getStateLabel(dispute.state, dispute.evidenceDueBy)}
                        tone={getStateClass(dispute.state)}
                      />
                    </td>
                    {bulk?.selectable ? (
                      <RowMenuCell bulk={bulk} row={dispute} actions={[{ id: "view", label: "View dispute", onRun: () => handleDispute(dispute.id) }]} />
                    ) : (
                    <td className="h-11.5 border-b border-hair px-4 text-ui text-right text-row-action">
                      <button
                        className="text-row-action hover:text-row-action-hover text-lg"
                        onClick={() => handleDispute(dispute.id)}
                        title="View dispute"
                      >
                        ⋯
                      </button>
                    </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Worth knowing section with PromptCard */}
          {data.wonThisYear > 0 && !wonTipDismissed && (
            <div className="mt-5">
              <div className="rounded-card border border-line bg-surface overflow-hidden">
                <div className="flex items-center gap-2.5 px-4.25 py-3.5 border-b border-hair">
                  <b className="flex-1 text-field font-medium text-ink">Worth knowing</b>
                </div>
                <div className="px-4.25 py-3.5">
                  <PromptCard
                    icon="$"
                    tone="warn"
                    headline="Both wins were won the same way"
                    why='Attendance records and a signed agreement. "Services not received" is answered by showing they were received — which you have, automatically, for every session.'
                    action={{
                      label: "See what we'd send",
                      // ★ FOUND LIVE, 28 Sep 2026 — both action.onClick and onDismiss were no-ops
                      //   (missing entirely / () => {}). "See what we'd send" opens the same
                      //   dispute-detail view "View dispute" already opens (assembleEvidence's
                      //   evidence list IS "what we'd send") — the most recent won dispute.
                      onClick: () => {
                        const won = data.rows.find((r) => r.state === "won");
                        if (won) handleDispute(won.id);
                      },
                    }}
                    onDismiss={() => setWonTipDismissed(true)}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </LedgerPage>
  );
}
